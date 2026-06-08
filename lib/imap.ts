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
    toHeader: string;
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

    // Method 1: Gmail X-GM-RAW — searches actual message content including real To: header
    try {
      uids = (await client.search(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { raw: `X-GM-RAW "to:${email}"` } as any,
        { uid: true }
      )) as number[];
      debug.searchMethod = "X-GM-RAW to:" + email;
    } catch {
      uids = [];
    }

    // Method 2: standard IMAP TO search
    if (!uids.length) {
      try {
        uids = (await client.search({ to: email }, { uid: true })) as number[];
        debug.searchMethod = "IMAP TO:" + email;
      } catch {
        uids = [];
      }
    }

    // Method 3: Gmail search for the alias anywhere in the message
    if (!uids.length) {
      try {
        uids = (await client.search(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { raw: `X-GM-RAW "${email}"` } as any,
          { uid: true }
        )) as number[];
        debug.searchMethod = "X-GM-RAW raw:" + email;
      } catch {
        uids = [];
      }
    }

    // Method 4: broad subject search + header check (last resort)
    if (!uids.length) {
      try {
        const broad = (await client.search(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { subject: "Enter code" } as any,
          { uid: true }
        )) as number[];
        debug.searchMethod = "subject:Enter code + header scan";
        // We'll check headers below
        uids = broad;
      } catch {
        uids = [];
      }
    }

    debug.searchCount = uids?.length || 0;
    if (!uids || uids.length === 0) return { entry: null, debug };

    const recent = uids.sort((a, b) => b - a).slice(0, 15);
    const targetEmail = email.toLowerCase().trim();

    for (const uid of recent) {
      try {
        // Fetch envelope + the To/Delivered-To headers from raw message
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

        // Get the raw To header (this has the real alias, not Gmail's rewrite)
        const headerMap: Map<string, string[]> | undefined = msg.headers;
        const rawHeaders = headerMap
          ? [...headerMap.values()].flat().join(" ")
          : "";

        const aliasInHeaders = rawHeaders.toLowerCase().includes(targetEmail);

        debug.checked.push({
          uid,
          subject: subject.slice(0, 80),
          toHeader: rawHeaders.slice(0, 120),
          codeFound: codeMatch ? codeMatch[1] : null,
        });

        // For methods 1-3, we trust the search. For method 4, verify alias.
        const trusted = debug.searchMethod.startsWith("X-GM-RAW") ||
                         debug.searchMethod.startsWith("IMAP TO");
        if (!trusted && !aliasInHeaders) continue;
        if (!codeMatch) continue;

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
      } catch {
        continue;
      }
    }

    return { entry: null, debug };
  } finally {
    await client.logout();
  }
}
