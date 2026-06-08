import { describe, it, expect } from "vitest-compat";
import { eventsForDate, layoutEventsForDay, dayBounds, type DayEvent } from "@/app/calendar/_day-view";

function ev(partial: Partial<DayEvent>): DayEvent {
  return {
    id: "x",
    userId: "u1",
    title: "T",
    startAt: "2026-04-15T09:00:00Z",
    endAt: null,
    allDay: false,
    kind: "appointment",
    ...partial,
  };
}

describe("eventsForDate", () => {
  it("returnerar bara events vars startAt = given dag", () => {
    const out = eventsForDate(
      [
        ev({ id: "a", startAt: new Date(2026, 3, 15, 9) }),
        ev({ id: "b", startAt: new Date(2026, 3, 16, 9) }),
        ev({ id: "c", startAt: new Date(2026, 3, 15, 23) }),
      ],
      new Date(2026, 3, 15),
    );
    expect(out.map((e) => e.id).sort()).toEqual(["a", "c"]);
  });

  it("tom input → tom output", () => {
    expect(eventsForDate([], new Date())).toEqual([]);
  });
});

describe("layoutEventsForDay", () => {
  it("inga events → tom layout", () => {
    expect(layoutEventsForDay([])).toEqual([]);
  });

  it("ett event → en kolumn, 100% bredd", () => {
    const out = layoutEventsForDay([
      ev({ startAt: new Date(2026, 3, 15, 10), endAt: new Date(2026, 3, 15, 11) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.leftPct).toBe(0);
    expect(out[0]!.widthPct).toBe(100);
  });

  it("två overlappande events → två kolumner med 50% var", () => {
    const out = layoutEventsForDay([
      ev({ id: "a", startAt: new Date(2026, 3, 15, 10), endAt: new Date(2026, 3, 15, 11, 30) }),
      ev({ id: "b", startAt: new Date(2026, 3, 15, 10, 30), endAt: new Date(2026, 3, 15, 12) }),
    ]);
    expect(out).toHaveLength(2);
    const a = out.find((x) => x.ev.id === "a")!;
    const b = out.find((x) => x.ev.id === "b")!;
    expect(a.widthPct).toBe(50);
    expect(b.widthPct).toBe(50);
    expect(new Set([a.leftPct, b.leftPct])).toEqual(new Set([0, 50]));
  });

  it("tre sekventiella (icke-overlappande) events delar en kolumn", () => {
    const out = layoutEventsForDay([
      ev({ id: "a", startAt: new Date(2026, 3, 15, 9), endAt: new Date(2026, 3, 15, 10) }),
      ev({ id: "b", startAt: new Date(2026, 3, 15, 10), endAt: new Date(2026, 3, 15, 11) }),
      ev({ id: "c", startAt: new Date(2026, 3, 15, 11), endAt: new Date(2026, 3, 15, 12) }),
    ]);
    expect(out).toHaveLength(3);
    for (const o of out) expect(o.widthPct).toBe(100);
    expect(new Set(out.map((o) => o.leftPct))).toEqual(new Set([0]));
  });

  it("event utan endAt får default 30 min höjd", () => {
    const out = layoutEventsForDay([
      ev({ startAt: new Date(2026, 3, 15, 10), endAt: null }),
    ]);
    const { hourHeight } = dayBounds();
    expect(out[0]!.height).toBeCloseTo(hourHeight * 0.5, 3);
  });

  it("top beräknas relativt DAY_START_HOUR", () => {
    const { startHour, hourHeight } = dayBounds();
    const out = layoutEventsForDay([
      ev({ startAt: new Date(2026, 3, 15, startHour + 2, 0), endAt: new Date(2026, 3, 15, startHour + 3, 0) }),
    ]);
    expect(out[0]!.top).toBeCloseTo(2 * hourHeight, 3);
  });
});
