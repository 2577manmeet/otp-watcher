import { ImapFlow } from "imapflow";

export interface OTPEntry {
  code: string;
  subject: string;
  date: string;
  from: string;
}

export interface DebugInfo {
  searchCount: number;
  checked: Array<{
    uid: number;
    subject: string;
    toAddresses: string[];
    codeFound: string | null;
    aliasMatch: boolean;
  }>;
}

export async function fetchLatestOTP(
  email: string
): Promise<{ entry: OTPEntry | null; debug: DebugInfo }> {
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
  const debug: DebugInfo = { searchCount: 0, checked: [] };

  try {
    await client.mailboxOpen("INBOX");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uids = (await client.search({ subject: "code" } as any, { uid: true })) as number[];
    debug.searchCount = uids?.length || 0;

    if (!uids || uids.length === 0) return { entry: null, debug };

    const recent = uids.sort((a, b) => b - a).slice(0, 10);
    const targetEmail = email.toLowerCase().trim();

    for (const uid of recent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = await (client as any).fetchOne(
        uid.toString(),
        { envelope: true },
        { uid: true }
      );
      if (!msg) continue;

      const recipients = [
        ...(msg.envelope?.to || []),
        ...(msg.envelope?.cc || []),
        ...(msg.envelope?.bcc || []),
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toAddresses = recipients.map((r: any) => r.address || `${r.user}@${r.host}` || "??");
      const subject: string = msg.envelope?.subject || "";
      const codeMatch = subject.match(/\b(\d{4,8})\b/);

      const aliasMatch = toAddresses.some(
        (addr: string) => addr.toLowerCase() === targetEmail
      );

      debug.checked.push({
        uid,
        subject: subject.slice(0, 80),
        toAddresses,
        codeFound: codeMatch ? codeMatch[1] : null,
        aliasMatch,
      });

      if (!aliasMatch || !codeMatch) continue;

      const fromAddr = msg.envelope?.from?.[0];
      const entry: OTPEntry = {
        code: codeMatch[1],
        subject,
        date: msg.envelope?.date
          ? new Date(msg.envelope.date).toISOString()
          : new Date().toISOString(),
        from: fromAddr
          ? `${fromAddr.name || ""} <${fromAddr.address || `${fromAddr.user}@${fromAddr.host}`}>`.trim()
          : "Unknown",
      };

      return { entry, debug };
    }

    return { entry: null, debug };
  } finally {
    await client.logout();
  }
}
