import { describe, it, expect } from "vitest-compat";
import { hasPeriod, listRange, periodFrom, periodTo } from "@/lib/client/time-filter";

describe("periodFrom", () => {
  it("returnerar undefined för tom sträng", () => {
    expect(periodFrom("")).toBeUndefined();
  });

  it("ger lokal dagstart (00:00:00.000)", () => {
    const d = periodFrom("2026-04-15")!;
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // april = 3
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
});

describe("periodTo", () => {
  it("returnerar undefined för tom sträng", () => {
    expect(periodTo("")).toBeUndefined();
  });

  it("ger lokal slut-på-dagen (23:59:59.999)", () => {
    const d = periodTo("2026-04-15")!;
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  it("till-gränsen ligger efter från-gränsen samma dag", () => {
    expect(periodTo("2026-04-15")!.getTime()).toBeGreaterThan(periodFrom("2026-04-15")!.getTime());
  });
});

describe("hasPeriod (#2096)", () => {
  it("är falsk utan Från och Till", () => {
    expect(hasPeriod("", "")).toBe(false);
  });

  it("är sann med bara Från, bara Till eller båda", () => {
    expect(hasPeriod("2026-01-01", "")).toBe(true);
    expect(hasPeriod("", "2026-01-31")).toBe(true);
    expect(hasPeriod("2026-01-01", "2026-01-31")).toBe(true);
  });
});

describe("listRange (#2096)", () => {
  const day = "2026-11-24";

  it("utan period gäller dagen, med periodens dygnsgränser", () => {
    expect(listRange(day, "", "")).toEqual({ from: periodFrom(day), to: periodTo(day) });
  });

  it("bara Från: öppen slutgräns, dagen ignoreras", () => {
    expect(listRange(day, "2026-01-01", "")).toEqual({ from: periodFrom("2026-01-01"), to: undefined });
  });

  it("bara Till: öppen startgräns, dagen ignoreras", () => {
    expect(listRange(day, "", "2026-01-31")).toEqual({ from: undefined, to: periodTo("2026-01-31") });
  });

  it("båda: perioden, dagen ignoreras", () => {
    expect(listRange(day, "2026-01-01", "2026-01-31")).toEqual({
      from: periodFrom("2026-01-01"), to: periodTo("2026-01-31"),
    });
  });
});
