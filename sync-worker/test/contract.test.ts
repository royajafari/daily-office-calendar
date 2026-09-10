import { describe, expect, it } from "vitest";
import { buildSyncPayload, SyncContractError, validateSyncPayload } from "../src/contract.js";
import type { EventSnapshot, QueueItem } from "../src/contract.js";

const item: QueueItem = {
  queueId: 1,
  eventId: 42,
  operation: "UPSERT",
  idempotencyKey: "42:UPSERT:20260101090000000",
  attempts: 1,
};

const snapshot: EventSnapshot = {
  eventId: 42,
  title: "Team sync",
  location: null,
  startsAt: "2026-01-01T09:00:00+00:00",
  endsAt: "2026-01-01T10:00:00+00:00",
  googleEventId: null,
};

describe("buildSyncPayload", () => {
  it("produces a schema-valid payload", () => {
    const payload = buildSyncPayload(item, snapshot);
    expect(payload.operation).toBe("UPSERT");
    expect(payload.idempotencyKey).toBe(item.idempotencyKey);
    expect(payload.event.eventId).toBe(42);
  });

  it("keeps the same idempotencyKey across retries (DO-AC-06)", () => {
    const first = buildSyncPayload(item, snapshot);
    const retried = buildSyncPayload({ ...item, attempts: item.attempts + 1 }, snapshot);
    expect(retried.idempotencyKey).toBe(first.idempotencyKey);
    expect(retried).toEqual(first);
  });
});

describe("validateSyncPayload", () => {
  it("rejects a payload missing required fields", () => {
    expect(() => validateSyncPayload({ operation: "UPSERT" })).toThrow(SyncContractError);
  });

  it("rejects an invalid operation value", () => {
    expect(() =>
      validateSyncPayload({
        operation: "PATCH",
        idempotencyKey: "abcdefgh",
        event: { eventId: 1, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-01T01:00:00Z" },
      })
    ).toThrow(SyncContractError);
  });

  it("rejects an idempotencyKey shorter than 8 characters", () => {
    expect(() =>
      validateSyncPayload({
        operation: "UPSERT",
        idempotencyKey: "short",
        event: { eventId: 1, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-01T01:00:00Z" },
      })
    ).toThrow(SyncContractError);
  });

  it("accepts a minimal valid DELETE payload", () => {
    expect(() =>
      validateSyncPayload({
        operation: "DELETE",
        idempotencyKey: "42:DELETE:20260101090000000",
        event: {
          eventId: 42,
          googleEventId: "abc123",
          startsAt: "2026-01-01T09:00:00+00:00",
          endsAt: "2026-01-01T10:00:00+00:00",
        },
      })
    ).not.toThrow();
  });
});
