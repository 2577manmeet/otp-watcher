import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

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

    // Search for emails addressed to this Hide My Email alias
    const messages = await client.search({
      to: email,
    });

    if (!messages || messages.length === 0) {
      return [];
    }

    // Take most recent `limit` messages
    const recent = messages.slice(-limit).reverse();

    for (const uid of recent) {
      const msg = await client.fetchOne(uid.toString(), {
        source: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msgAny = msg as any;
      if (!msgAny?.source) continue;

      const parsed = await simpleParser(msgAny.source);
      const subject = parsed.subject || "";

      // Extract 4-8 digit code from subject
      const codeMatch = subject.match(/\b(\d{4,8})\b/);
      if (!codeMatch) continue;

      results.push({
        code: codeMatch[1],
        subject: subject,
        date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
        from: parsed.from?.text || "Unknown",
      });
    }
  } finally {
    await client.logout();
  }

  return results;
}
