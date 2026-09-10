import type { AppointmentRequestInput, BusyBlock } from "./types";

export const DEMO_BUSY_BLOCKS: BusyBlock[] = [
  { startsAt: "2026-09-14T08:30:00+03:30", endsAt: "2026-09-14T09:30:00+03:30" },
  { startsAt: "2026-09-14T11:00:00+03:30", endsAt: "2026-09-14T12:00:00+03:30" },
  { startsAt: "2026-09-15T09:00:00+03:30", endsAt: "2026-09-15T10:30:00+03:30" },
  { startsAt: "2026-09-16T13:00:00+03:30", endsAt: "2026-09-16T14:00:00+03:30" },
];

export interface StoredDemoRequest extends AppointmentRequestInput {
  id: number;
  status: "PENDING";
  createdAt: string;
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
  return [...demoRequests];
}
