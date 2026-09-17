import type { AppointmentRequestInput, BusyBlock } from "./types";

export const DEMO_BUSY_BLOCKS: BusyBlock[] = [
  { startsAt: "2026-09-14T08:30:00+03:30", endsAt: "2026-09-14T09:30:00+03:30" },
  { startsAt: "2026-09-14T11:00:00+03:30", endsAt: "2026-09-14T12:00:00+03:30" },
  { startsAt: "2026-09-15T09:00:00+03:30", endsAt: "2026-09-15T10:30:00+03:30" },
  { startsAt: "2026-09-16T13:00:00+03:30", endsAt: "2026-09-16T14:00:00+03:30" },
];

export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface StoredDemoRequest extends AppointmentRequestInput {
  id: number;
  status: RequestStatus;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

// In-memory only — resets on every cold start / redeploy. This demo has no
// real backend by default, so there is nothing durable to lose; when
// ORACLE_API_BASE_URL is set, requests go to the real Oracle backend instead
// and this store is not used.
const demoRequests: StoredDemoRequest[] = [];
let nextId = 1;

export function addDemoRequest(input: AppointmentRequestInput): StoredDemoRequest {
  const record: StoredDemoRequest = {
    ...input,
    id: nextId++,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };
  demoRequests.push(record);
  return record;
}

export function listDemoRequests(): StoredDemoRequest[] {
  return [...demoRequests].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getDemoRequestById(id: number): StoredDemoRequest | undefined {
  return demoRequests.find((r) => r.id === id);
}

export class DemoReviewError extends Error {}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
}

/**
 * Mirrors daily_office_api.review_request: APPROVED conflict-checks against
 * every other already-APPROVED request (the demo-store stand-in for
 * CONFIRMED office_events) before committing, so two competing requests for
 * the same slot can never both end up approved — same guarantee the real
 * Oracle package enforces via check_conflict inside create_event.
 */
export function reviewDemoRequest(
  id: number,
  decision: "APPROVED" | "REJECTED",
  reviewedBy: string,
  reviewNote?: string
): StoredDemoRequest {
  const record = getDemoRequestById(id);
  if (!record) {
    throw new DemoReviewError("درخواستی با این شناسه یافت نشد.");
  }
  if (record.status !== "PENDING") {
    throw new DemoReviewError("این درخواست قبلاً بررسی شده است.");
  }

  if (decision === "APPROVED") {
    const conflict = demoRequests.some(
      (r) =>
        r.status === "APPROVED" &&
        r.id !== record.id &&
        overlaps(record.startsAt, record.endsAt, r.startsAt, r.endsAt)
    );
    if (conflict) {
      throw new DemoReviewError(
        "این بازه‌ی زمانی با یک رویداد تأییدشده‌ی دیگر تداخل دارد."
      );
    }
  }

  record.status = decision;
  record.reviewedBy = reviewedBy;
  record.reviewedAt = new Date().toISOString();
  record.reviewNote = reviewNote?.trim() || undefined;
  return record;
}
