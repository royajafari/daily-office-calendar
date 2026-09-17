import { NextResponse } from "next/server";
import { fetchRequestStatusFromOrds } from "@/lib/ordsClient";
import { getDemoRequestById } from "@/lib/demo-data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = Number(id);

  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "شناسه‌ی درخواست نامعتبر است." }, { status: 400 });
  }

  const ordsBaseUrl = process.env.ORACLE_API_BASE_URL;

  if (ordsBaseUrl) {
    try {
      const row = await fetchRequestStatusFromOrds(ordsBaseUrl, requestId);
      if (!row) {
        return NextResponse.json({ error: "درخواستی با این شناسه یافت نشد." }, { status: 404 });
      }
      return NextResponse.json(row);
    } catch (err) {
      return NextResponse.json(
        {
          error: "بررسی وضعیت روی سرور واقعی ناموفق بود.",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 }
      );
    }
  }

  const demoRequest = getDemoRequestById(requestId);
  if (!demoRequest) {
    return NextResponse.json({ error: "درخواستی با این شناسه یافت نشد." }, { status: 404 });
  }

  return NextResponse.json({
    id: demoRequest.id,
    eventType: demoRequest.eventType,
    title: demoRequest.title,
    status: demoRequest.status,
    startsAt: demoRequest.startsAt,
    endsAt: demoRequest.endsAt,
    reviewedAt: demoRequest.reviewedAt ?? null,
    reviewNote: demoRequest.reviewNote ?? null,
  });
}
