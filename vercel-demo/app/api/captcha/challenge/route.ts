import { NextResponse } from "next/server";
import { issueChallenge } from "@/lib/captcha";

// POST, not GET: a GET route handler can be prerendered and cached at build
// time, which would hand every visitor the same challenge.
export async function POST() {
  try {
    return NextResponse.json(issueChallenge(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "captcha-unavailable" }, { status: 500 });
  }
}
