import { NextResponse } from "next/server";
import { verifySolution } from "@/lib/captcha";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; nonce?: unknown } | null;
  try {
    const result = verifySolution(body?.token, body?.nonce);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result.value, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "captcha-unavailable" }, { status: 500 });
  }
}
