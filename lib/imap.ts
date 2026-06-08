import { ImapFlow } from "imapflow";

export interface OTPEntry {
  code: string;
  subject: string;
  date: string;
  from: string;
}

export interface DebugInfo {
  totalMessages: number;
  fetchedRange: string;
  checked: Array<{
    seq: number;
    uid: number;
    subject: string;
    date: string;
    codeFound: string | null;
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
  const debug: DebugInfo = { totalMessages: 0, fetchedRange: "", checked: [] };

  try {
    const mailbox = await client.mailboxOpen("INBOX");
    debug.totalMessages = mailbox.exists || 0;

    if (!debug.totalMessages) return { entry: null, debug };

    // Grab the last 30 messages by sequence number — no SEARCH needed
    const lastSeq = debug.totalMessages;
    const startSeq = Math.max(1, lastSeq - 29);
    debug.fetchedRange = `${startSeq}:${lastSeq}`;

    const candidates: Array<{
      seq: number;
      uid: number;
      subject: string;
      date: Date;
      from: string;
      code: string;
    }> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const msg of (client as any).fetch(`${startSeq}:${lastSeq}`, { envelope: true })) {
      const subject: string = msg.envelope?.subject || "";
      const codeMatch = subject.match(/\b(\d{4,8})\b/);
      const msgDate = msg.envelope?.date ? new Date(msg.envelope.date) : new Date(0);

      debug.checked.push({
        seq: msg.seq || 0,
        uid: msg.uid || 0,
        subject: subject.slice(0, 80),
        date: msgDate.toISOString(),
        codeFound: codeMatch ? codeMatch[1] : null,
      });

      if (!codeMatch) continue;

      // Check if subject looks like an OTP email
      const isOTP = /(?:code|verification|verify|sign.?in|one.?time|otp|2fa|two.?step)/i.test(subject);
      if (!isOTP) continue;

      const fromAddr = msg.envelope?.from?.[0];
      candidates.push({
        seq: msg.seq || 0,
        uid: msg.uid || 0,
        subject,
        date: msgDate,
        from: fromAddr
          ? `${fromAddr.name || ""} <${fromAddr.address || `${fromAddr.user}@${fromAddr.host}`}>`.trim()
          : "Unknown",
        code: codeMatch[1],
      });
    }

    // Sort by date descending, return the newest OTP
    candidates.sort((a, b) => b.date.getTime() - a.date.getTime());

    if (candidates.length > 0) {
      const best = candidates[0];
      return {
        entry: {
          code: best.code,
          subject: best.subject,
          date: best.date.toISOString(),
          from: best.from,
        },
        debug,
      };
    }

    return { entry: null, debug };
  } finally {
    await client.logout();
  }
}
