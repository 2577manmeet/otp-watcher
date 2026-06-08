import { ImapFlow } from "imapflow";

export interface OTPEntry {
  code: string;
  subject: string;
  date: string;
  from: string;
}

export interface DebugInfo {
  searchMethod: string;
  searchCount: number;
  checked: Array<{
    uid: number;
    subject: string;
    rawHeaders: string;
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
  const debug: DebugInfo = { searchMethod: "", searchCount: 0, checked: [] };

  try {
    await client.mailboxOpen("INBOX");

    let uids: number[] = [];

    // Try Gmail X-GM-RAW first — best for finding alias-specific emails
    try {
      uids = (await client.search(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { raw: `X-GM-RAW "to:${email} subject:code"` } as any,
        { uid: true }
      )) as number[];
      if (uids.length) debug.searchMethod = "X-GM-RAW";
    } catch { uids = []; }

    // Fallback: subject search
    if (!uids.length) {
      try {
        uids = (await client.search(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { subject: "Enter code" } as any,
          { uid: true }
        )) as number[];
        if (uids.length) debug.searchMethod = "subject:Enter code";
      } catch { uids = []; }
    }

    debug.searchCount = uids?.length || 0;
    if (!uids || uids.length === 0) return { entry: null, debug };

    const recent = uids.sort((a, b) => b - a).slice(0, 5);
    const targetEmail = email.toLowerCase().trim();

    for (const uid of recent) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = await (client as any).fetchOne(
          uid.toString(),
          {
            envelope: true,
            headers: ["to", "delivered-to", "x-forwarded-to", "x-original-to"],
          },
          { uid: true }
        );
        if (!msg) continue;

        const subject: string = msg.envelope?.subject || "";
        const codeMatch = subject.match(/\b(\d{4,8})\b/);

        // Decode headers — could be Buffer, Map, or string
        let rawHeaders = "";
        if (msg.headers) {
          if (Buffer.isBuffer(msg.headers)) {
            rawHeaders = msg.headers.toString("utf-8");
          } else if (msg.headers instanceof Map) {
            const parts: string[] = [];
            msg.headers.forEach((val: unknown, key: string) => {
              const v = Buffer.isBuffer(val) ? val.toString("utf-8") : String(val);
              parts.push(`${key}: ${v}`);
            });
            rawHeaders = parts.join("\n");
          } else if (typeof msg.headers === "object") {
            // Could be a plain object or iterable
            try {
              rawHeaders = JSON.stringify(msg.headers);
            } catch {
              rawHeaders = String(msg.headers);
            }
          } else {
            rawHeaders = String(msg.headers);
          }
        }

        const aliasFound = rawHeaders.toLowerCase().includes(targetEmail);

        debug.checked.push({
          uid,
          subject: subject.slice(0, 80),
          rawHeaders: rawHeaders.slice(0, 200),
          codeFound: codeMatch ? codeMatch[1] : null,
        });

        if (!codeMatch) continue;

        // If alias found in headers, perfect match
        // If not found but using X-GM-RAW (trusted search), still accept
        // If subject search + no alias in headers, still return it
        // (Target "Enter code" is specific enough, user chose the alias in URL)
        const fromAddr = msg.envelope?.from?.[0];
        return {
          entry: {
            code: codeMatch[1],
            subject,
            date: msg.envelope?.date
              ? new Date(msg.envelope.date).toISOString()
              : new Date().toISOString(),
            from: fromAddr
              ? `${fromAddr.name || ""} <${fromAddr.address || `${fromAddr.user}@${fromAddr.host}`}>`.trim()
              : "Unknown",
          },
          debug: { ...debug, searchMethod: debug.searchMethod + (aliasFound ? " ✓alias" : " (no alias in headers)") },
        };
      } catch {
        continue;
      }
    }

    return { entry: null, debug };
  } finally {
    await client.logout();
  }
}
