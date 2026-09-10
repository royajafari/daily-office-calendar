import { describe, expect, it } from "vitest";
import { addDemoRequest, listDemoRequests } from "../lib/demo-data";

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
});
