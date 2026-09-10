import { describe, expect, it } from "vitest";
import { validateAppointmentRequest } from "../lib/validate";

const VALID_INPUT = {
  requestedBy: "علی رضایی",
  eventType: "MEETING" as const,
  title: "بررسی بودجه",
  startsAt: "2026-09-20T09:00:00+03:30",
  endsAt: "2026-09-20T10:00:00+03:30",
};

describe("validateAppointmentRequest", () => {
  it("accepts a fully valid request", () => {
    expect(validateAppointmentRequest(VALID_INPUT)).toEqual([]);
  });

  it("requires requestedBy", () => {
    const errors = validateAppointmentRequest({ ...VALID_INPUT, requestedBy: "  " });
    expect(errors.some((e) => e.field === "requestedBy")).toBe(true);
  });

  it("requires title", () => {
    const errors = validateAppointmentRequest({ ...VALID_INPUT, title: "" });
    expect(errors.some((e) => e.field === "title")).toBe(true);
  });

  it("rejects an unknown eventType", () => {
    const errors = validateAppointmentRequest({ ...VALID_INPUT, eventType: "PARTY" as never });
    expect(errors.some((e) => e.field === "eventType")).toBe(true);
  });

  it("rejects endsAt before startsAt (mirrors ORA-20001)", () => {
    const errors = validateAppointmentRequest({
      ...VALID_INPUT,
      startsAt: "2026-09-20T10:00:00+03:30",
      endsAt: "2026-09-20T09:00:00+03:30",
    });
    expect(errors.some((e) => e.field === "endsAt")).toBe(true);
  });

  it("rejects an unparsable date", () => {
    const errors = validateAppointmentRequest({ ...VALID_INPUT, startsAt: "not-a-date" });
    expect(errors.some((e) => e.field === "startsAt")).toBe(true);
  });

  it("reports all missing required fields at once", () => {
    const errors = validateAppointmentRequest({});
    const fields = errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining(["requestedBy", "title", "eventType", "startsAt", "endsAt"])
    );
  });
});
