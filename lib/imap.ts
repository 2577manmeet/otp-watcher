import { ImapFlow } from "imapflow";

export interface OTPEntry {
  code: string;
  subject: string;
  date: string;
  from: string;
}

export async function fetchLatestOTP(email: string): Promise<OTPEntry | null> {
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

  try {
    await client.mailboxOpen("INBOX");

    // Server-side search for OTP-looking emails
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uids = (await client.search({ subject: "code" } as any, { uid: true })) as number[];
    if (!uids || uids.length === 0) return null;

    // Newest 20 first
    const recent = uids.sort((a, b) => b - a).slice(0, 20);

    const targetEmail = email.toLowerCase().trim();

    for (const uid of recent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = await (client as any).fetchOne(
        uid.toString(),
        { envelope: true },
        { uid: true }
      );
      if (!msg) continue;

      // Check all envelope recipient fields — parsed by imapflow, no byte limits
      const recipients = [
        ...(msg.envelope?.to || []),
        ...(msg.envelope?.cc || []),
        ...(msg.envelope?.bcc || []),
      ];

      const matches = recipients.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => (r.address || "").toLowerCase() === targetEmail
      );
      if (!matches) continue;

      const subject: string = msg.envelope?.subject || "";
      const codeMatch = subject.match(/\b(\d{4,8})\b/);
      if (!codeMatch) continue;

      const fromAddr = msg.envelope?.from?.[0];
      return {
        code: codeMatch[1],
        subject,
        date: msg.envelope?.date
          ? new Date(msg.envelope.date).toISOString()
          : new Date().toISOString(),
        from: fromAddr
          ? `${fromAddr.name || ""} <${fromAddr.address || ""}>`.trim()
          : "Unknown",
      };
    }

    return null;
  } finally {
    await client.logout();
  }
}
