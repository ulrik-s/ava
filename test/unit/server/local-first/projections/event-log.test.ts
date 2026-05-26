import { describe, it, expect } from "vitest";
import { EventLogProjection } from "@/lib/server/local-first/projections/event-log";
import { dayBucketPath, monthBucketPath } from "@/lib/server/local-first/projections/time-bucket";
import type { AvaEvent } from "@/lib/server/events/schema";

describe("time-bucket helpers", () => {
  it("dayBucketPath zero-pad:ar månad och dag", () => {
    expect(dayBucketPath("events", new Date("2026-01-05T00:00:00Z"))).toBe("events/2026/01/05.jsonl");
  });

  it("monthBucketPath zero-pad:ar månad", () => {
    expect(monthBucketPath("time-entries/anna", new Date("2026-01-15T00:00:00Z"))).toBe("time-entries/anna/2026/01.jsonl");
  });

  it("monthBucketPath hanterar december", () => {
    expect(monthBucketPath("logs", new Date("2026-12-31T23:59:59Z"))).toBe("logs/2026/12.jsonl");
  });
});

const event: AvaEvent = {
  id: "01900000-0000-7000-8000-000000000001",
  ts: "2026-05-18T10:30:00.000Z",
  type: "matter.created",
  source: "ui",
  actor: { kind: "user", id: "anna" },
  payload: { matterNumber: "2026-0001" },
};

describe("EventLogProjection", () => {
  const proj = new EventLogProjection();

  it("path härleds från event.ts (år/månad/dag) — ej från id", () => {
    expect(proj.pathFor(event)).toBe("events/2026/05/18.jsonl");
  });

  it("hanterar januari/dag-1 med zero-pad", () => {
    expect(proj.pathFor({ ...event, ts: "2026-01-01T00:00:00.000Z" })).toBe(
      "events/2026/01/01.jsonl",
    );
  });

  it("serialiserar en rad utan trailing newline", () => {
    const line = proj.serializeLine(event);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(event);
  });

  it("round-trip serializeLine/deserializeLine bevarar event", () => {
    expect(proj.deserializeLine(proj.serializeLine(event))).toEqual(event);
  });

  it("deserialiserar bara giltiga events", () => {
    expect(() => proj.deserializeLine('{"id":"x"}')).toThrow();
  });
});
