import { ImapFlow } from "imapflow";

export interface OTPEntry {
  code: string;
  subject: string;
  date: string;
  from: string;
}

export async function fetchOTPCodes(
  email: string,
  limit = 10
): Promise<OTPEntry[]> {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: parseInt(process.env.IMAP_PORT || "993"),
    secure: true,
    auth: {
      user: process.env.IMAP_USER!,
      pass: process.env.IMAP_PASS!,
    },
    logger: false,
  });

  await client.connect();
  const results: OTPEntry[] = [];

  try {
    await client.mailboxOpen("INBOX");

    // Try server-side header searches (fast, no download needed)
    // header: { "header-name": "value" } per imapflow docs
    const searches = [
      { header: { "X-Forwarded-To": email } },
      { header: { "Delivered-To": email } },
      { header: { "X-Original-To": email } },
    ];

    const uidSets = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      searches.map((q) => client.search(q as any, { uid: true }).catch(() => [] as number[]))
    );

    let allUids = [...new Set(uidSets.flat() as number[])];

    // Fallback: search by subject keyword (still server-side, no download)
    if (allUids.length === 0) {
      const subjectUids = await client.search(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { or: [{ subject: "sign in" }, { subject: "verification code" }, { subject: "Enter code" }] } as any,
        { uid: true }
      ).catch(() => [] as number[]);
      allUids = subjectUids as number[];
    }

    if (allUids.length === 0) return [];

    // Sort descending (newest first)
    const recentUids = (allUids as number[]).sort((a, b) => b - a).slice(0, limit * 3);

    // Fetch envelope + small header slice in parallel
    const fetchPromises = recentUids.map(async (uid) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = await (client as any).fetchOne(
          uid.toString(),
          { envelope: true, source: { start: 0, maxLength: 1000 } },
          { uid: true }
        );
        if (!msg) return null;

        const subject: string = msg.envelope?.subject || "";
        const codeMatch = subject.match(/\b(\d{4,8})\b/);
        if (!codeMatch) return null;

        const date = msg.envelope?.date
          ? new Date(msg.envelope.date).toISOString()
          : new Date().toISOString();

        const fromAddr = msg.envelope?.from?.[0];
        const from = fromAddr
          ? `${fromAddr.name || ""} <${fromAddr.address || ""}>`.trim()
          : "Unknown";

        return { code: codeMatch[1], subject, date, from } as OTPEntry;
      } catch {
        return null;
      }
    });

    const fetched = await Promise.all(fetchPromises);
    const valid = fetched.filter(Boolean) as OTPEntry[];
    valid.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return valid.slice(0, limit);
  } finally {
    await client.logout();
  }
}
