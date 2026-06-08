import { describe, expect, test } from "bun:test";

import { compareSemver, isNewer, parseSemver } from "../src/semver.ts";

describe("parseSemver", () => {
  test("plockar X.Y.Z ur olika tag-format", () => {
    expect(parseSemver("helper-v1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
  });
  test("null för ogiltig tag", () => {
    expect(parseSemver("dev")).toBeNull();
    expect(parseSemver("helper-vX")).toBeNull();
  });
});

describe("compareSemver", () => {
  test("ordnar korrekt", () => {
    expect(compareSemver([1, 0, 0], [1, 0, 1])).toBe(-1);
    expect(compareSemver([1, 2, 0], [1, 1, 9])).toBe(1);
    expect(compareSemver([2, 0, 0], [2, 0, 0])).toBe(0);
  });
});

describe("isNewer", () => {
  test("true bara när kandidaten är strikt nyare", () => {
    expect(isNewer("helper-v1.2.4", "helper-v1.2.3")).toBe(true);
    expect(isNewer("helper-v1.2.3", "helper-v1.2.3")).toBe(false);
    expect(isNewer("helper-v1.2.2", "helper-v1.2.3")).toBe(false);
  });
  test("false när någon version är oparsbar (skyddar dev-build)", () => {
    expect(isNewer("helper-v1.2.4", "dev")).toBe(false);
    expect(isNewer("dev", "helper-v1.2.3")).toBe(false);
  });
});
