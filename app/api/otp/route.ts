import { NextRequest, NextResponse } from "next/server";
import { getLatestOTP } from "@/lib/watcher";

export const maxDuration = 30;
// Always run dynamically so the in-memory cache is shared across requests
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  try {
    const entry = await getLatestOTP(decodeURIComponent(email));
    return NextResponse.json(
      { entry },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err: unknown) {
    console.error("IMAP error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch" },
      { status: 500 }
    );
  }
}
