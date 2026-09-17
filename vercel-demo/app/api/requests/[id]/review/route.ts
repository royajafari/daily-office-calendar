import { NextResponse } from "next/server";
import { DemoReviewError, reviewDemoRequest } from "@/lib/demo-data";

/**
 * Demo-store only, deliberately. There is no ORDS write endpoint for
 * approve/reject (see db/packages/003_ords_modules.sql) because that action
 * must be authenticated as OFFICE_HEAD inside APEX — exposing it here,
 * even passcode-gated in the UI, would mean an unauthenticated write
 * endpoint sitting on the real database once ORDS is reachable. This route
 * only ever mutates the in-memory demo store, never the real backend.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = Number(id);

  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "شناسه‌ی درخواست نامعتبر است." }, { status: 400 });
  }

  if (process.env.ORACLE_API_BASE_URL) {
    return NextResponse.json(
      {
        error:
          "این یک پیش‌نمایش موقت است. وقتی به سرور Oracle واقعی وصل هستیم، تأیید/رد فقط از طریق APEX (با احراز هویت رئیس/منشی) انجام می‌شود.",
      },
      { status: 501 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    decision?: "APPROVED" | "REJECTED";
    reviewedBy?: string;
    reviewNote?: string;
  } | null;

  if (!body?.decision || !["APPROVED", "REJECTED"].includes(body.decision)) {
    return NextResponse.json({ error: "decision باید APPROVED یا REJECTED باشد." }, { status: 400 });
  }

  if (body.decision === "REJECTED" && !body.reviewNote?.trim()) {
    return NextResponse.json(
      { error: "برای رد درخواست، نوشتن دلیل الزامی است." },
      { status: 400 }
    );
  }

  try {
    const record = reviewDemoRequest(
      requestId,
      body.decision,
      body.reviewedBy || "منشی (پیش‌نمایش)",
      body.reviewNote
    );
    return NextResponse.json(record);
  } catch (err) {
    if (err instanceof DemoReviewError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
