import type { AppointmentRequestInput, BusyBlock } from "./types";

/**
 * Calls the public, restricted ORDS endpoints only (GET availability, POST
 * requests — see db/packages/003_ords_modules.sql). Never called with any
 * Oracle credential: those endpoints require none for these two operations.
 */
export async function fetchAvailabilityFromOrds(
  baseUrl: string,
  from: string,
  to: string
): Promise<BusyBlock[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/availability?from_ts=${encodeURIComponent(
    from
  )}&to_ts=${encodeURIComponent(to)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ORDS availability request failed: ${res.status}`);
  }

  const body = (await res.json()) as { items?: Array<{ starts_at: string; ends_at: string }> };
  return (body.items ?? []).map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at }));
}

export async function submitRequestToOrds(
  baseUrl: string,
  input: AppointmentRequestInput
): Promise<{ id: number }> {
  const url = `${baseUrl.replace(/\/$/, "")}/requests`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requested_by: input.requestedBy,
      event_type: input.eventType,
      title: input.title,
      note: input.note ?? null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
    }),
  });

  if (!res.ok) {
    throw new Error(`ORDS submit request failed: ${res.status}`);
  }

  const body = (await res.json()) as { request_id: number };
  return { id: body.request_id };
}

export interface RequestStatusRow {
  id: number;
  eventType: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export async function fetchRequestStatusFromOrds(
  baseUrl: string,
  requestId: number
): Promise<RequestStatusRow | null> {
  const url = `${baseUrl.replace(/\/$/, "")}/requests/${requestId}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`ORDS request status lookup failed: ${res.status}`);
  }

  const body = (await res.json()) as {
    items?: Array<{
      id: number;
      event_type: string;
      title: string;
      status: string;
      starts_at: string;
      ends_at: string;
      reviewed_at: string | null;
      review_note: string | null;
    }>;
  };
  const row = body.items?.[0];
  if (!row) return null;

  return {
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
  };
}
