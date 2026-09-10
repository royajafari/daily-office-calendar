import type { AppointmentRequestInput, EventType } from "./types";

export interface FieldError {
  field: string;
  message: string;
}

const VALID_EVENT_TYPES: EventType[] = ["MEETING", "MISSION", "APPOINTMENT", "OTHER"];

/**
 * Mirrors the checks daily_office_api.submit_request enforces in the real
 * database (DO-AC-05 — clear validation errors, not raw exceptions), so the
 * demo gives the same feedback whether or not ORACLE_API_BASE_URL is set.
 */
export function validateAppointmentRequest(
  input: Partial<AppointmentRequestInput>
): FieldError[] {
  const errors: FieldError[] = [];

  if (!input.requestedBy?.trim()) {
    errors.push({ field: "requestedBy", message: "نام الزامی است." });
  }

  if (!input.title?.trim()) {
    errors.push({ field: "title", message: "عنوان الزامی است." });
  }

  if (!input.eventType || !VALID_EVENT_TYPES.includes(input.eventType)) {
    errors.push({ field: "eventType", message: "نوع رویداد نامعتبر است." });
  }

  if (!input.startsAt) {
    errors.push({ field: "startsAt", message: "زمان شروع الزامی است." });
  }

  if (!input.endsAt) {
    errors.push({ field: "endsAt", message: "زمان پایان الزامی است." });
  }

  if (input.startsAt && input.endsAt) {
    const starts = new Date(input.startsAt);
    const ends = new Date(input.endsAt);

    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
      errors.push({ field: "startsAt", message: "قالب تاریخ/زمان نامعتبر است." });
    } else if (ends <= starts) {
      errors.push({ field: "endsAt", message: "زمان پایان باید بعد از زمان شروع باشد." });
    }
  }

  return errors;
}
