"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface OTPEntry {
  code: string;
  subject: string;
  date: string;
  from: string;
}

interface DebugChecked {
  uid: number;
  subject: string;
  toAddresses: string[];
  codeFound: string | null;
  aliasMatch: boolean;
}

interface DebugInfo {
  searchCount: number;
  checked: DebugChecked[];
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function EmailPage() {
  const params = useParams();
  const email = decodeURIComponent(params.email as string);

  const [entry, setEntry] = useState<OTPEntry | null>(null);
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(30);

  const fetchCode = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/otp?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setEntry(data.entry ?? null);
      setDebug(data.debug ?? null);
      setCountdown(30);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => { fetchCode(); }, [fetchCode]);

  useEffect(() => {
    const interval = setInterval(fetchCode, 30000);
    return () => clearInterval(interval);
  }, [fetchCode]);

  useEffect(() => {
    const tick = setInterval(() => setCountdown((c) => (c <= 1 ? 30 : c - 1)), 1000);
    return () => clearInterval(tick);
  }, [entry]);

  function copyCode() {
    if (!entry) return;
    navigator.clipboard.writeText(entry.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono flex flex-col">
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${loading ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`} />
          <span className="text-xs text-white/40 uppercase tracking-widest">OTP Watcher</span>
        </div>
        <button onClick={fetchCode} disabled={loading}
          className="text-xs text-white/40 hover:text-white/80 transition-colors flex items-center gap-2 disabled:opacity-40">
          <svg className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? "fetching…" : `refresh in ${countdown}s`}
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <p className="text-xs text-white/30 uppercase tracking-widest mb-1">Watching</p>
        <p className="text-sm text-emerald-400 mb-16 break-all text-center">{email}</p>

        {loading && !entry && !debug && (
          <div className="text-center">
            <div className="w-8 h-8 border border-white/20 border-t-white/60 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-xs text-white/30">Connecting to IMAP…</p>
          </div>
        )}

        {error && (
          <div className="border border-red-500/30 bg-red-500/5 rounded-lg px-5 py-3 text-center">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {entry && (
          <div onClick={copyCode} className="cursor-pointer text-center group select-none">
            <div className="text-[80px] font-bold tracking-[0.2em] leading-none text-white group-hover:text-emerald-400 transition-colors">
              {entry.code}
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-white/30 group-hover:text-emerald-400/60 transition-colors">
              {copied ? (
                <><svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7" /></svg><span className="text-xs text-emerald-400">Copied!</span></>
              ) : (
                <><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg><span className="text-xs">tap to copy</span></>
              )}
            </div>
            <p className="text-xs text-white/20 mt-6 max-w-xs mx-auto truncate">{entry.subject}</p>
            <p className="text-xs text-white/15 mt-1">{timeAgo(entry.date)}</p>
          </div>
        )}

        {!loading && !error && !entry && (
          <div className="text-center">
            <p className="text-white/20 text-sm">No sign-in codes found.</p>
            <p className="text-white/10 text-xs mt-2">Will auto-check every 30s.</p>
          </div>
        )}

        {/* Debug panel */}
        {debug && (
          <div className="mt-16 w-full max-w-xl border border-white/10 rounded-lg p-4">
            <p className="text-xs text-yellow-500 uppercase tracking-widest mb-3">Debug info</p>
            <p className="text-xs text-white/40 mb-2">IMAP search for subject &quot;code&quot; returned <span className="text-white">{debug.searchCount}</span> UIDs</p>
            <p className="text-xs text-white/40 mb-3">Looking for alias: <span className="text-emerald-400">{email}</span></p>
            {debug.checked.map((c, i) => (
              <div key={i} className="border-t border-white/5 py-2">
                <p className="text-xs text-white/50">UID {c.uid}: <span className="text-white/70">{c.subject}</span></p>
                <p className="text-xs text-white/30">
                  To: [{c.toAddresses.join(", ")}]
                  {" | "}code: {c.codeFound || "none"}
                  {" | "}alias match: <span className={c.aliasMatch ? "text-emerald-400" : "text-red-400"}>{c.aliasMatch ? "YES" : "NO"}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
