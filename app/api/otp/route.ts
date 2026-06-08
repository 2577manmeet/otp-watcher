import { NextRequest, NextResponse } from "next/server";
import { fetchLatestOTP } from "@/lib/imap";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  try {
    const entry = await fetchLatestOTP(decodeURIComponent(email));
    return NextResponse.json({ entry });
  } catch (err: unknown) {
    console.error("IMAP error:", err);
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
