import { describe, it, expect } from "vitest-compat";
import {
  avaEventSchema,
  eventFilterSchema,
  EVENT_TYPES,
  type AvaEvent,
} from "@/lib/server/events/schema";

describe("avaEventSchema", () => {
  const validEvent: AvaEvent = {
    id: "01900000-0000-7000-8000-000000000001",
    ts: "2026-05-18T10:00:00.000Z",
    type: "matter.created",
    source: "ui",
    actor: { kind: "user", id: "anna" },
    matterId: "matter-1",
    payload: { title: "Vårdnadstvist" },
  };

  it("accepterar ett komplett, korrekt event", () => {
    expect(() => avaEventSchema.parse(validEvent)).not.toThrow();
  });

  it("avvisar en okänd event-typ", () => {
    expect(() => avaEventSchema.parse({ ...validEvent, type: "matter.exploded" })).toThrow();
  });

  it("matterId och causedBy är valfria", () => {
    const { matterId: _m, ...withoutMatter } = validEvent;
    expect(() => avaEventSchema.parse(withoutMatter)).not.toThrow();
  });

  it("kastar om actor saknar id", () => {
    expect(() => avaEventSchema.parse({ ...validEvent, actor: { kind: "user", id: "" } })).toThrow();
  });

  it("kastar om payload inte är ett objekt", () => {
    expect(() => avaEventSchema.parse({ ...validEvent, payload: "ej-objekt" })).toThrow();
  });

  it("har inventerade event-typer", () => {
    expect(EVENT_TYPES).toContain("matter.created");
    expect(EVENT_TYPES).toContain("rule.executed");
    expect(EVENT_TYPES).toContain("mail.received");
  });
});

describe("eventFilterSchema", () => {
  it("accepterar tomt filter", () => {
    expect(() => eventFilterSchema.parse({})).not.toThrow();
  });

  it("accepterar filter med array av typer", () => {
    expect(() =>
      eventFilterSchema.parse({ type: ["matter.created", "matter.updated"] }),
    ).not.toThrow();
  });

  it("kastar om limit är negativ", () => {
    expect(() => eventFilterSchema.parse({ limit: -1 })).toThrow();
  });

  it("kastar om since är ogiltig ISO-sträng", () => {
    expect(() => eventFilterSchema.parse({ since: "igår" })).toThrow();
  });
});
