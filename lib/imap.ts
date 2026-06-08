import { ImapFlow } from "imapflow";

export interface OTPEntry {
  code: string;
  subject: string;
  date: string;
  from: string;
}

export interface DebugInfo {
  totalMessages: number;
  otpCandidates: number;
  aliasFoundInSource: boolean;
  sourceSnippet: string;
  checked: Array<{
    seq: number;
    subject: string;
    codeFound: string | null;
    hasAlias: boolean | null;
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
  const debug: DebugInfo = {
    totalMessages: 0, otpCandidates: 0,
    aliasFoundInSource: false, sourceSnippet: "",
    checked: [],
  };

  try {
    const mailbox = await client.mailboxOpen("INBOX");
    debug.totalMessages = mailbox.exists || 0;
    if (!debug.totalMessages) return { entry: null, debug };

    const lastSeq = debug.totalMessages;
    const startSeq = Math.max(1, lastSeq - 29);
    const targetEmail = email.toLowerCase().trim();

    // Pass 1: get envelopes, find OTP candidates
    interface Candidate {
      seq: number;
      uid: number;
      subject: string;
      date: Date;
      from: string;
      code: string;
    }
    const candidates: Candidate[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const msg of (client as any).fetch(`${startSeq}:${lastSeq}`, { envelope: true, uid: true })) {
      const subject: string = msg.envelope?.subject || "";
      const codeMatch = subject.match(/\b(\d{4,8})\b/);
      const isOTP = /(?:code|verification|verify|sign.?in|one.?time|otp|2fa|two.?step)/i.test(subject);

      if (codeMatch && isOTP) {
        const fromAddr = msg.envelope?.from?.[0];
        candidates.push({
          seq: msg.seq || 0,
          uid: msg.uid || 0,
          subject,
          date: msg.envelope?.date ? new Date(msg.envelope.date) : new Date(0),
          from: fromAddr
            ? `${fromAddr.name || ""} <${fromAddr.address || `${fromAddr.user}@${fromAddr.host}`}>`.trim()
            : "Unknown",
          code: codeMatch[1],
        });
      }
    }

    debug.otpCandidates = candidates.length;
    candidates.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Pass 2: for each candidate (newest first), fetch raw source headers
    // and check if the iCloud alias appears in Received: chains
    for (const c of candidates.slice(0, 10)) {
      try {
        // Fetch first 8KB of raw source — covers all Received: headers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = await (client as any).fetchOne(
          c.uid.toString(),
          { source: { start: 0, maxLength: 8000 } },
          { uid: true }
        );

        const rawSource = msg?.source
          ? (Buffer.isBuffer(msg.source) ? msg.source.toString("utf-8") : String(msg.source))
          : "";

        const hasAlias = rawSource.toLowerCase().includes(targetEmail);

        debug.checked.push({
          seq: c.seq,
          subject: c.subject.slice(0, 60),
          codeFound: c.code,
          hasAlias,
        });

        if (hasAlias) {
          debug.aliasFoundInSource = true;
          // Show context around the alias
          const idx = rawSource.toLowerCase().indexOf(targetEmail);
          const start = Math.max(0, idx - 40);
          const end = Math.min(rawSource.length, idx + targetEmail.length + 40);
          debug.sourceSnippet = rawSource.slice(start, end).replace(/\r?\n/g, " ");

          return {
            entry: {
              code: c.code,
              subject: c.subject,
              date: c.date.toISOString(),
              from: c.from,
            },
            debug,
          };
        }
      } catch {
        debug.checked.push({
          seq: c.seq,
          subject: c.subject.slice(0, 60),
          codeFound: c.code,
          hasAlias: null,
        });
      }
    }

    return { entry: null, debug };
  } finally {
    await client.logout();
  }
}
