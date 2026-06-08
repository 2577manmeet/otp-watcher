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
    const mailbox = await client.mailboxOpen("INBOX");
    const total = mailbox.exists || 0;
    if (!total) return null;

    const lastSeq = total;
    const startSeq = Math.max(1, lastSeq - 29);
    const targetEmail = email.toLowerCase().trim();

    // Pass 1: scan last 30 envelopes for OTP candidates
    interface Candidate { uid: number; subject: string; date: Date; from: string; code: string; }
    const candidates: Candidate[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const msg of (client as any).fetch(`${startSeq}:${lastSeq}`, { envelope: true, uid: true })) {
      const subject: string = msg.envelope?.subject || "";
      const codeMatch = subject.match(/\b(\d{4,8})\b/);
      if (!codeMatch) continue;
      if (!/(?:code|verification|verify|sign.?in|one.?time|otp|2fa|two.?step)/i.test(subject)) continue;

      const fromAddr = msg.envelope?.from?.[0];
      candidates.push({
        uid: msg.uid || 0,
        subject,
        date: msg.envelope?.date ? new Date(msg.envelope.date) : new Date(0),
        from: fromAddr
          ? `${fromAddr.name || ""} <${fromAddr.address || `${fromAddr.user}@${fromAddr.host}`}>`.trim()
          : "Unknown",
        code: codeMatch[1],
      });
    }

    candidates.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Pass 2: check raw source for alias in Received headers
    for (const c of candidates.slice(0, 10)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = await (client as any).fetchOne(
          c.uid.toString(),
          { source: { start: 0, maxLength: 8000 } },
          { uid: true }
        );
        const raw = msg?.source
          ? (Buffer.isBuffer(msg.source) ? msg.source.toString("utf-8") : String(msg.source))
          : "";

        if (!raw.toLowerCase().includes(targetEmail)) continue;

        return {
          code: c.code,
          subject: c.subject,
          date: c.date.toISOString(),
          from: c.from,
        };
      } catch {
        continue;
      }
    }

    return null;
  } finally {
    await client.logout();
  }
}
