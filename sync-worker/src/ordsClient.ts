import type { WorkerConfig } from "./config.js";
import type { EventSnapshot, QueueItem, SyncOperation } from "./contract.js";

interface OrdsCollectionResponse<T> {
  items?: T[];
}

export class OrdsClient {
  constructor(private readonly config: WorkerConfig) {}

  private authHeader(): Record<string, string> {
    if (!this.config.ordsUser || !this.config.ordsPassword) return {};
    const token = Buffer.from(`${this.config.ordsUser}:${this.config.ordsPassword}`).toString(
      "base64"
    );
    return { Authorization: `Basic ${token}` };
  }

  private url(pathSegment: string): string {
    return `${this.config.ordsBaseUrl.replace(/\/$/, "")}/${pathSegment.replace(/^\//, "")}`;
  }

  async claimNext(): Promise<QueueItem | null> {
    const res = await fetch(this.url("sync-queue/next"), {
      method: "POST",
      headers: { ...this.authHeader() },
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`claimNext failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as Record<string, unknown>;
    return {
      queueId: body.queue_id as number,
      eventId: body.event_id as number,
      operation: body.operation as SyncOperation,
      idempotencyKey: body.idempotency_key as string,
      attempts: body.attempts as number,
    };
  }

  async getEventSnapshot(eventId: number): Promise<EventSnapshot> {
    const res = await fetch(this.url(`sync-queue/event/${eventId}`), {
      headers: { ...this.authHeader() },
    });
    if (!res.ok) throw new Error(`getEventSnapshot failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as OrdsCollectionResponse<Record<string, unknown>>;
    const row = body.items?.[0];
    if (!row) throw new Error(`Event ${eventId} not found via ORDS`);

    return {
      eventId: row.event_id as number,
      title: (row.title as string) ?? null,
      location: (row.location as string) ?? null,
      startsAt: row.starts_at as string,
      endsAt: row.ends_at as string,
      googleEventId: (row.google_event_id as string) ?? null,
    };
  }

  async reportResult(queueId: number, status: "DONE" | "FAILED", error?: string): Promise<void> {
    const res = await fetch(this.url(`sync-queue/${queueId}/result`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeader() },
      body: JSON.stringify({ sync_status: status, error_message: error ?? null }),
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`reportResult failed: ${res.status} ${await res.text()}`);
    }
  }
}
