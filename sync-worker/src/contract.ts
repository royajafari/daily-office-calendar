import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

export type SyncOperation = "UPSERT" | "DELETE";

export interface SyncEventPayload {
  eventId: number;
  googleEventId?: string | null;
  title?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
}

export interface SyncContractPayload {
  operation: SyncOperation;
  idempotencyKey: string;
  event: SyncEventPayload;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../contracts/google-calendar-upsert.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn: ValidateFunction = ajv.compile(schema);

export class SyncContractError extends Error {}

export function validateSyncPayload(payload: unknown): asserts payload is SyncContractPayload {
  if (!validateFn(payload)) {
    const details = (validateFn.errors ?? [])
      .map((e) => `${e.instancePath || "(root)"} ${e.message}`)
      .join("; ");
    throw new SyncContractError(`Invalid Google Calendar sync payload: ${details}`);
  }
}

export interface QueueItem {
  queueId: number;
  eventId: number;
  operation: SyncOperation;
  idempotencyKey: string;
  attempts: number;
}

export interface EventSnapshot {
  eventId: number;
  googleEventId?: string | null;
  title?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
}

/**
 * Pure function: builds the Google Calendar sync contract payload for one
 * queue item. idempotencyKey always comes straight from the queue row, so
 * retrying the same row (attempts > 1) yields byte-identical operation +
 * idempotencyKey — the property DO-AC-06 depends on.
 */
export function buildSyncPayload(item: QueueItem, snapshot: EventSnapshot): SyncContractPayload {
  const payload: SyncContractPayload = {
    operation: item.operation,
    idempotencyKey: item.idempotencyKey,
    event: {
      eventId: snapshot.eventId,
      googleEventId: snapshot.googleEventId ?? null,
      title: snapshot.title ?? null,
      location: snapshot.location ?? null,
      startsAt: snapshot.startsAt,
      endsAt: snapshot.endsAt,
    },
  };
  validateSyncPayload(payload);
  return payload;
}
