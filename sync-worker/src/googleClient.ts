import type { SyncContractPayload } from "./contract.js";
import type { WorkerConfig } from "./config.js";

export interface GoogleClient {
  upsert(payload: SyncContractPayload): Promise<{ googleEventId: string }>;
  remove(payload: SyncContractPayload): Promise<void>;
}

class DryRunGoogleClient implements GoogleClient {
  async upsert(payload: SyncContractPayload): Promise<{ googleEventId: string }> {
    console.log(
      `[dry-run] would UPSERT Google event for office_events.id=${payload.event.eventId} ` +
        `(idempotencyKey=${payload.idempotencyKey})`
    );
    return { googleEventId: `dry-run-${payload.event.eventId}` };
  }

  async remove(payload: SyncContractPayload): Promise<void> {
    console.log(
      `[dry-run] would DELETE Google event googleEventId=${payload.event.googleEventId ?? "(none)"} ` +
        `(idempotencyKey=${payload.idempotencyKey})`
    );
  }
}

class RealGoogleClient implements GoogleClient {
  constructor(private readonly config: NonNullable<WorkerConfig["google"]>) {}

  private async getCalendarApi() {
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email: this.config.clientEmail,
      key: this.config.privateKey,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    return google.calendar({ version: "v3", auth });
  }

  /**
   * Google Calendar's API has no native idempotency-key parameter for
   * events.insert, so idempotency (DO-AC-06) is implemented here: every
   * created event carries idempotencyKey in extendedProperties.private, and
   * every UPSERT first looks for an existing event with that key before
   * inserting a new one. A retry after a failed/interrupted attempt (where
   * Oracle never got the googleEventId back) therefore finds and reuses the
   * already-created Google event instead of duplicating it.
   */
  async upsert(payload: SyncContractPayload): Promise<{ googleEventId: string }> {
    const calendar = await this.getCalendarApi();

    if (payload.event.googleEventId) {
      const res = await calendar.events.update({
        calendarId: this.config.calendarId,
        eventId: payload.event.googleEventId,
        requestBody: this.toRequestBody(payload),
      });
      return { googleEventId: res.data.id as string };
    }

    const existing = await calendar.events.list({
      calendarId: this.config.calendarId,
      privateExtendedProperty: [`idempotencyKey=${payload.idempotencyKey}`],
      maxResults: 1,
    });
    const found = existing.data.items?.[0];
    if (found?.id) {
      return { googleEventId: found.id };
    }

    const res = await calendar.events.insert({
      calendarId: this.config.calendarId,
      requestBody: this.toRequestBody(payload),
    });
    return { googleEventId: res.data.id as string };
  }

  async remove(payload: SyncContractPayload): Promise<void> {
    if (!payload.event.googleEventId) return;
    const calendar = await this.getCalendarApi();
    await calendar.events.delete({
      calendarId: this.config.calendarId,
      eventId: payload.event.googleEventId,
    });
  }

  private toRequestBody(payload: SyncContractPayload) {
    return {
      summary: payload.event.title ?? undefined,
      location: payload.event.location ?? undefined,
      start: { dateTime: payload.event.startsAt },
      end: { dateTime: payload.event.endsAt },
      extendedProperties: { private: { idempotencyKey: payload.idempotencyKey } },
    };
  }
}

export function createGoogleClient(config: WorkerConfig): GoogleClient {
  return config.dryRun || !config.google
    ? new DryRunGoogleClient()
    : new RealGoogleClient(config.google);
}
