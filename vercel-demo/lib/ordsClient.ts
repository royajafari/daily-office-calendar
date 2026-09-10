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
): Promise<Record<string, unknown>> {
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

  return res.json();
}
