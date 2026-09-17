import { describe, expect, it } from "vitest";
import { addDemoRequest, getDemoRequestById, listDemoRequests } from "../lib/demo-data";

describe("demo-data store", () => {
  it("assigns an incrementing id and PENDING status to new requests", () => {
    const before = listDemoRequests().length;

    const created = addDemoRequest({
      requestedBy: "سارا احمدی",
      eventType: "APPOINTMENT",
      title: "پیگیری پرونده",
      startsAt: "2026-09-21T09:00:00+03:30",
      endsAt: "2026-09-21T09:30:00+03:30",
    });

    expect(created.status).toBe("PENDING");
    expect(created.id).toBeGreaterThan(0);
    expect(listDemoRequests().length).toBe(before + 1);
  });

  it("looks a request up by id", () => {
    const created = addDemoRequest({
      requestedBy: "رضا کریمی",
      eventType: "MEETING",
      title: "جلسه هماهنگی",
      startsAt: "2026-09-22T09:00:00+03:30",
      endsAt: "2026-09-22T09:30:00+03:30",
    });

    expect(getDemoRequestById(created.id)?.title).toBe("جلسه هماهنگی");
    expect(getDemoRequestById(-1)).toBeUndefined();
  });
});
