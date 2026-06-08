"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [email, setEmail] = useState("");
  const router = useRouter();

  function go() {
    const trimmed = email.trim();
    if (trimmed) router.push(`/${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-xs text-white/40 uppercase tracking-widest">OTP Watcher</span>
        </div>
        <h1 className="text-2xl font-semibold mb-2">Check sign-in codes</h1>
        <p className="text-sm text-white/40 mb-8">Enter a Hide My Email address to view its latest OTP codes.</p>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="alias@icloud.com"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm placeholder-white/20 focus:outline-none focus:border-emerald-500/50 focus:bg-white/[0.07] transition-all"
          />
          <button
            onClick={go}
            className="bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
          >
            Go
          </button>
        </div>
        <p className="text-xs text-white/20 mt-4">
          Or visit <span className="text-white/40">yourdomain.com/alias@icloud.com</span> directly
        </p>
      </div>
    </div>
  );
}
