import { NextResponse } from "next/server";
import { listDemoRequests } from "@/lib/demo-data";

/**
 * Demo-store listing only, deliberately — see review/route.ts for why this
 * never proxies to a real ORDS "list all requests" endpoint (no such public,
 * unauthenticated endpoint exists; listing everyone's requests is exactly
 * the kind of thing that belongs behind APEX's OFFICE_HEAD authentication).
 */
export async function GET() {
  if (process.env.ORACLE_API_BASE_URL) {
    return NextResponse.json(
      {
        error:
          "این یک پیش‌نمایش موقت است. فهرست واقعی درخواست‌ها فقط در صفحه‌ی Review در APEX (با احراز هویت) در دسترس است.",
        items: [],
      },
      { status: 501 }
    );
  }

  return NextResponse.json({ items: listDemoRequests() });
}
