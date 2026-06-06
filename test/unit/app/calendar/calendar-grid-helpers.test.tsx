/**
 * Pure-helper-tester för CalendarGrid (månadsraster, ISO-vecknr,
 * event-bucketing).
 */

import { describe, it, expect } from "vitest";
import {
  startOfDay,
  sameDay,
  toKey,
  mondayWeekday,
  weekDays,
  monthGridDays,
  monthRange,
  weekRange,
  shift,
  getISOWeek,
  bucketEventsByDay,
} from "@/app/calendar/_calendar-grid";

describe("startOfDay / sameDay / toKey", () => {
  it("startOfDay nollar tiden", () => {
    const d = startOfDay(new Date("2026-04-15T13:42:11.000Z"));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it("sameDay ignorerar tid", () => {
    const a = new Date(2026, 3, 15, 0, 0, 0);
    const b = new Date(2026, 3, 15, 23, 59, 59);
    expect(sameDay(a, b)).toBe(true);
    expect(sameDay(a, new Date(2026, 3, 16))).toBe(false);
  });

  it("toKey ger ISO-liknande nyckel", () => {
    expect(toKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("mondayWeekday", () => {
  it("måndag → 0, söndag → 6", () => {
    // 2026-01-05 är en måndag
    expect(mondayWeekday(new Date(2026, 0, 5))).toBe(0);
    // 2026-01-11 är en söndag
    expect(mondayWeekday(new Date(2026, 0, 11))).toBe(6);
  });
});

describe("weekDays", () => {
  it("returnerar 7 dagar måndag→söndag som täcker ankaret", () => {
    const days = weekDays(new Date(2026, 0, 7)); // onsdag
    expect(days).toHaveLength(7);
    expect(toKey(days[0]!)).toBe("2026-01-05"); // måndag
    expect(toKey(days[6]!)).toBe("2026-01-11"); // söndag
  });
});

describe("monthGridDays", () => {
  it("returnerar 42 dagar för en månad och startar på måndag", () => {
    const days = monthGridDays(new Date(2026, 0, 15));
    expect(days).toHaveLength(42);
    expect(mondayWeekday(days[0]!)).toBe(0);
    // 1 januari 2026 är en torsdag → grid:en ska börja på måndagen innan
    expect(toKey(days[0]!)).toBe("2025-12-29");
  });

  it("hanterar månader som börjar på måndag (ingen padding före)", () => {
    // 2026-06-01 är en måndag
    const days = monthGridDays(new Date(2026, 5, 10));
    expect(toKey(days[0]!)).toBe("2026-06-01");
  });
});

describe("weekRange / monthRange", () => {
  it("weekRange omsluter alla 7 dagar", () => {
    const { from, to } = weekRange(new Date(2026, 0, 7));
    expect(toKey(from)).toBe("2026-01-05");
    expect(toKey(to)).toBe("2026-01-11");
    expect(to.getHours()).toBe(23);
  });

  it("monthRange omsluter alla 42 grid-dagar", () => {
    const { from, to } = monthRange(new Date(2026, 0, 15));
    expect(from.getTime()).toBeLessThan(to.getTime());
  });
});

describe("shift", () => {
  it("week shiftar 7 dagar", () => {
    const after = shift(new Date(2026, 0, 7), "week", 1);
    expect(toKey(after)).toBe("2026-01-14");
  });

  it("month shiftar till nästa månad första dagen", () => {
    const after = shift(new Date(2026, 0, 15), "month", 1);
    expect(after.getMonth()).toBe(1);
    expect(after.getDate()).toBe(1);
  });

  it("week shiftar bakåt", () => {
    const before = shift(new Date(2026, 0, 7), "week", -1);
    expect(toKey(before)).toBe("2025-12-31");
  });
});

describe("getISOWeek", () => {
  it("1 januari 2026 → vecka 1 (året startar på torsdag)", () => {
    expect(getISOWeek(new Date(2026, 0, 1))).toBe(1);
  });

  it("31 december 2024 → vecka 1 av 2025 (ISO-regel)", () => {
    expect(getISOWeek(new Date(2024, 11, 31))).toBe(1);
  });

  it("4 juli 2026 → vecka 27", () => {
    expect(getISOWeek(new Date(2026, 6, 4))).toBe(27);
  });
});

describe("bucketEventsByDay", () => {
  const days = monthGridDays(new Date(2026, 0, 15));

  it("placerar event på rätt dag och sorterar inom dagen", () => {
    const buckets = bucketEventsByDay(
      [
        { id: "b", userId: "u1", title: "Sen", kind: "appointment", startAt: "2026-01-15T15:00:00Z", allDay: false },
        { id: "a", userId: "u1", title: "Tidig", kind: "appointment", startAt: "2026-01-15T09:00:00Z", allDay: false },
        { id: "c", userId: "u2", title: "Frist", kind: "deadline", startAt: "2026-01-22T00:00:00Z", allDay: true },
      ],
      days,
    );
    const day15 = buckets.get("2026-01-15");
    expect(day15?.map((e) => e.id)).toEqual(["a", "b"]);
    expect(buckets.get("2026-01-22")?.[0]?.id).toBe("c");
  });

  it("event utanför grid-fönstret hamnar i ingen bucket", () => {
    const buckets = bucketEventsByDay(
      [{ id: "z", userId: "u1", title: "Långt bort", kind: "appointment", startAt: "2027-05-01T00:00:00Z", allDay: false }],
      days,
    );
    for (const arr of buckets.values()) expect(arr.find((e) => e.id === "z")).toBeUndefined();
  });

  it("tom event-lista → alla buckets är tomma men finns", () => {
    const buckets = bucketEventsByDay([], days);
    expect(buckets.size).toBe(42);
    for (const arr of buckets.values()) expect(arr).toEqual([]);
  });
});
