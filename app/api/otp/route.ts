import { NextRequest, NextResponse } from "next/server";
import { fetchOTPCodes } from "@/lib/imap";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");

  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  try {
    const codes = await fetchOTPCodes(decodeURIComponent(email), 10);
    return NextResponse.json({ codes });
  } catch (err: unknown) {
    console.error("IMAP error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch codes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
