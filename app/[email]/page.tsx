"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface OTPEntry {
  code: string;
  subject: string;
  date: string;
  from: string;
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
  const rawEmail = params.email as string;
  const email = decodeURIComponent(rawEmail);

  const [codes, setCodes] = useState<OTPEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [countdown, setCountdown] = useState(30);

  const fetchCodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/otp?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setCodes(data.codes);
      setLastRefresh(new Date());
      setCountdown(30);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    fetchCodes();
  }, [fetchCodes]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchCodes();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchCodes]);

  // Countdown timer
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 30 : c - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastRefresh]);

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  const latest = codes[0];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-white/40 uppercase tracking-widest">OTP Watcher</span>
        </div>
        <button
          onClick={fetchCodes}
          className="text-xs text-white/40 hover:text-white/80 transition-colors flex items-center gap-2"
        >
          <svg className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          refresh in {countdown}s
        </button>
      </div>

      <div className="max-w-xl mx-auto px-6 py-10">
        {/* Email label */}
        <div className="mb-8">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-1">Watching inbox for</p>
          <p className="text-sm text-emerald-400 break-all">{email}</p>
        </div>

        {/* Loading */}
        {loading && codes.length === 0 && (
          <div className="text-center py-20">
            <div className="w-8 h-8 border border-white/20 border-t-white/60 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-xs text-white/30">Connecting to IMAP…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="border border-red-500/30 bg-red-500/5 rounded-lg px-4 py-3 mb-6">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Latest code — big display */}
        {latest && (
          <div className="mb-8">
            <p className="text-xs text-white/30 uppercase tracking-widest mb-3">Latest code</p>
            <div
              className="border border-white/10 rounded-xl p-6 cursor-pointer hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all group"
              onClick={() => copyCode(latest.code)}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-5xl font-bold tracking-[0.25em] text-white">
                  {latest.code}
                </span>
                <div className="text-white/20 group-hover:text-emerald-400 transition-colors">
                  {copied === latest.code ? (
                    <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  )}
                </div>
              </div>
              <p className="text-xs text-white/30 truncate">{latest.subject}</p>
              <p className="text-xs text-white/20 mt-1">{timeAgo(latest.date)}</p>
            </div>
          </div>
        )}

        {/* History */}
        {codes.length > 1 && (
          <div>
            <p className="text-xs text-white/30 uppercase tracking-widest mb-3">Recent history</p>
            <div className="space-y-2">
              {codes.slice(1).map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border border-white/5 rounded-lg px-4 py-3 cursor-pointer hover:border-white/15 hover:bg-white/[0.02] transition-all group"
                  onClick={() => copyCode(entry.code)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-semibold tracking-widest text-white/70 group-hover:text-white transition-colors">
                        {entry.code}
                      </span>
                      <span className="text-xs text-white/20">{timeAgo(entry.date)}</span>
                    </div>
                    <p className="text-xs text-white/20 truncate mt-0.5">{entry.subject}</p>
                  </div>
                  <div className="text-white/10 group-hover:text-white/40 transition-colors ml-3 shrink-0">
                    {copied === entry.code ? (
                      <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                      </svg>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && codes.length === 0 && (
          <div className="text-center py-20">
            <p className="text-white/20 text-sm">No sign-in codes found for this address.</p>
            <p className="text-white/10 text-xs mt-2">Codes are extracted from email subjects.</p>
          </div>
        )}
      </div>
    </div>
  );
}
