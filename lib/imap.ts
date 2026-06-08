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

    // Fetch recent messages and filter by searching raw source for the alias
    // Can't rely on To: header — iCloud Hide My Email forwarded to Gmail
    // only shows Gmail address in To:. The alias appears in Delivered-To,
    // X-Forwarded-To, or X-Original-To headers in the raw source.
    const allMessages = await client.search({ seen: false }, { uid: true });
    const seenMessages = await client.search({ seen: true }, { uid: true });
    const allUids = [...(allMessages || []), ...(seenMessages || [])];

    // Sort descending, take recent batch to scan
    const recentUids = allUids.sort((a, b) => Number(b) - Number(a)).slice(0, 50);

    for (const uid of recentUids) {
      if (results.length >= limit) break;

      const msg = await client.fetchOne(uid.toString(), { source: true }, { uid: true });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msgAny = msg as any;
      if (!msgAny?.source) continue;

      const rawSource = msgAny.source.toString("utf8");

      // Check if the alias appears anywhere in the raw headers
      const lowerSource = rawSource.slice(0, 2000).toLowerCase(); // only scan headers
      if (!lowerSource.includes(email.toLowerCase())) continue;

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
