import { describe, it, expect } from "vitest-compat";
import { periodFrom, periodTo } from "@/lib/client/time-filter";

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
