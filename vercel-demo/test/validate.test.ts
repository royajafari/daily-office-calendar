import { describe, expect, it } from "vitest";
import { validateAppointmentRequest } from "../lib/validate";

// Relative to "now" so this test suite keeps passing as real time moves on.
const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const startsAt = new Date(oneWeekFromNow.getTime()).toISOString();
const endsAt = new Date(oneWeekFromNow.getTime() + 60 * 60 * 1000).toISOString();

const VALID_INPUT = {
  requestedBy: "علی رضایی",
  eventType: "MEETING" as const,
  title: "بررسی بودجه",
  startsAt,
  endsAt,
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
      startsAt: endsAt,
      endsAt: startsAt,
    });
    expect(errors.some((e) => e.field === "endsAt")).toBe(true);
  });

  it("rejects a duration shorter than 15 minutes (mirrors ORA-20007)", () => {
    const errors = validateAppointmentRequest({
      ...VALID_INPUT,
      endsAt: new Date(new Date(startsAt).getTime() + 10 * 60 * 1000).toISOString(),
    });
    expect(errors.some((e) => e.field === "endsAt")).toBe(true);
  });

  it("accepts a duration of exactly 15 minutes", () => {
    const errors = validateAppointmentRequest({
      ...VALID_INPUT,
      endsAt: new Date(new Date(startsAt).getTime() + 15 * 60 * 1000).toISOString(),
    });
    expect(errors).toEqual([]);
  });

  it("rejects a startsAt in the past", () => {
    const errors = validateAppointmentRequest({
      ...VALID_INPUT,
      startsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(errors.some((e) => e.field === "startsAt")).toBe(true);
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
