import { ImapFlow } from "imapflow";

export interface OTPEntry {
  code: string;
  subject: string;
  date: string;
  from: string;
}

interface CachedEntry extends OTPEntry {
  uid: number;
  search: string; // lowercased recipient text (envelope To/Cc + raw headers) for alias matching
  ts: number;
}

interface WatcherState {
  client: ImapFlow | null;
  starting: Promise<void> | null;
  scanning: Promise<void> | null;
  cache: CachedEntry[];
  seen: Set<number>;
  pollTimer: ReturnType<typeof setInterval> | null;
  warmed: boolean;
}

// Persist across hot-reload / multiple imports within the same Node process
const g = globalThis as unknown as { __otpWatcher?: WatcherState };
const state: WatcherState =
  g.__otpWatcher ??
  (g.__otpWatcher = {
    client: null,
    starting: null,
    scanning: null,
    cache: [],
    seen: new Set<number>(),
    pollTimer: null,
    warmed: false,
  });

const POLL_MS = 4000; // background scan cadence — "check often"
const SCAN_COUNT = 30; // how many most-recent messages to look at each scan
const MAX_CACHE = 80; // retain a longer history of codes
const OTP_SUBJECT_RE = /(?:code|verification|verify|sign.?in|one.?time|otp|2fa|two.?step)/i;

function makeClient(): ImapFlow {
  return new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: parseInt(process.env.IMAP_PORT || "993"),
    secure: true,
    auth: {
      user: process.env.IMAP_USER!,
      pass: process.env.IMAP_PASS!,
    },
    logger: false,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addrText(list: any[] | undefined): string {
  return (list || [])
    .map((a) => `${a.name || ""} ${a.address || `${a.user}@${a.host}`}`)
    .join(" ")
    .toLowerCase();
}

async function connect(): Promise<void> {
  const client = makeClient();
  // Swallow async errors so they don't crash the process; reconnect on next scan
  client.on("error", () => {});
  client.on("close", () => {
    if (state.client === client) state.client = null;
  });
  await client.connect();
  await client.mailboxOpen("INBOX");
  state.client = client;
}

async function ensureConnected(): Promise<void> {
  if (state.client && state.client.usable) return;
  if (!state.starting) {
    state.starting = connect()
      .catch((err) => {
        state.client = null;
        throw err;
      })
      .finally(() => {
        state.starting = null;
      });
  }
  await state.starting;
}

async function runScan(): Promise<void> {
  await ensureConnected();
  const client = state.client!;

  // current message count in the open mailbox (ImapFlow keeps this updated)
  const total = client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.exists || 0 : 0;
  if (!total) return;

  const start = Math.max(1, total - (SCAN_COUNT - 1));

  // Pass 1: pull envelopes (cheap, single streamed command)
  interface Found { uid: number; subject: string; date: Date; from: string; toText: string; }
  const fresh: Found[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const msg of (client as any).fetch(`${start}:${total}`, { envelope: true, uid: true })) {
    const uid: number = msg.uid || 0;
    if (state.seen.has(uid)) continue; // already processed this message

    const subject: string = msg.envelope?.subject || "";
    const codeMatch = subject.match(/\b(\d{4,8})\b/);
    if (!codeMatch || !OTP_SUBJECT_RE.test(subject)) {
      // Not an OTP mail — but don't mark seen, cheap to skip again next time
      continue;
    }

    const fromAddr = msg.envelope?.from?.[0];
    fresh.push({
      uid,
      subject,
      date: msg.envelope?.date ? new Date(msg.envelope.date) : new Date(),
      from: fromAddr
        ? `${fromAddr.name || ""} <${fromAddr.address || `${fromAddr.user}@${fromAddr.host}`}>`.trim()
        : "Unknown",
      toText: `${addrText(msg.envelope?.to)} ${addrText(msg.envelope?.cc)}`,
    });
  }

  // Pass 2: for each NEW OTP mail, fetch raw headers ONCE to capture the alias
  // (Hide My Email can hide the real recipient in Delivered-To / Received headers).
  // This happens once per message in the background, never on the request path.
  for (const f of fresh) {
    let headerText = "";
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = await (client as any).fetchOne(f.uid.toString(), { headers: true }, { uid: true });
      if (msg?.headers) {
        headerText = (Buffer.isBuffer(msg.headers) ? msg.headers.toString("utf-8") : String(msg.headers)).toLowerCase();
      }
    } catch {
      // ignore — envelope To/Cc still gives us something to match on
    }

    state.seen.add(f.uid);
    state.cache.push({
      code: (f.subject.match(/\b(\d{4,8})\b/) || ["", ""])[1],
      subject: f.subject,
      date: f.date.toISOString(),
      from: f.from,
      uid: f.uid,
      search: `${f.toText} ${headerText}`,
      ts: f.date.getTime(),
    });
  }

  if (fresh.length) {
    // newest first, keep a bounded but generous history
    state.cache.sort((a, b) => b.ts - a.ts);
    if (state.cache.length > MAX_CACHE) state.cache.length = MAX_CACHE;
  }
}

// Only one scan runs at a time; concurrent callers await the same promise
function scanOnce(): Promise<void> {
  if (!state.scanning) {
    state.scanning = runScan()
      .catch((err) => {
        console.error("OTP scan error:", err instanceof Error ? err.message : err);
      })
      .finally(() => {
        state.scanning = null;
      });
  }
  return state.scanning;
}

function startBackgroundPolling(): void {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(() => {
    void scanOnce();
  }, POLL_MS);
  // don't keep the event loop alive solely for this timer
  if (typeof state.pollTimer.unref === "function") state.pollTimer.unref();
}

/**
 * Returns the latest OTP for an alias, reading from the in-memory cache.
 * On the very first call it warms the cache with one scan; after that the
 * background poller keeps it fresh and responses are effectively instant.
 */
export async function getLatestOTP(email: string): Promise<OTPEntry | null> {
  startBackgroundPolling();

  // Cold start: make sure we've scanned at least once before answering
  if (!state.warmed) {
    await scanOnce();
    state.warmed = true;
  }

  const target = email.toLowerCase().trim();
  const match = state.cache.find((c) => c.search.includes(target));
  if (!match) return null;

  return {
    code: match.code,
    subject: match.subject,
    date: match.date,
    from: match.from,
  };
}
