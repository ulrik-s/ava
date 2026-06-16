/**
 * Seed-väg (#408) — prepareSeedRow/coerceDate: version-default, datum-coercion,
 * deletedAt-normalisering.
 */

import { describe, it, expect } from "vitest-compat";
import { coerceDate, prepareSeedRow } from "@/lib/server/db/seed-rows";

const NOW = new Date("2026-06-16T12:00:00.000Z");

describe("coerceDate", () => {
  it("null/undefined → null", () => {
    expect(coerceDate(null)).toBeNull();
    expect(coerceDate(undefined)).toBeNull();
  });
  it("Date → samma instans; ISO-sträng → Date", () => {
    const d = new Date();
    expect(coerceDate(d)).toBe(d);
    expect(coerceDate("2026-01-02T03:04:05.000Z")).toBeInstanceOf(Date);
  });
});

describe("prepareSeedRow", () => {
  it("defaultar version till 1 och deletedAt till null", () => {
    const r = prepareSeedRow({ id: "u1", name: "Anna" }, NOW);
    expect(r.version).toBe(1);
    expect(r.deletedAt).toBeNull();
    expect(r.createdAt).toBe(NOW); // saknad createdAt → now
    expect(r.updatedAt).toBe(NOW); // saknad updatedAt → createdAt
    expect(r.name).toBe("Anna"); // domänfält bevaras
  });

  it("behåller explicit version och coercar ISO-datum", () => {
    const r = prepareSeedRow(
      { id: "m1", version: 4, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" },
      NOW,
    );
    expect(r.version).toBe(4);
    expect(r.createdAt).toBeInstanceOf(Date);
    expect((r.createdAt as Date).getUTCFullYear()).toBe(2026);
    expect((r.updatedAt as Date).getUTCMonth()).toBe(1); // februari
  });

  it("updatedAt faller tillbaka på createdAt när det saknas", () => {
    const r = prepareSeedRow({ id: "x", createdAt: "2026-03-03T00:00:00.000Z" }, NOW);
    expect((r.updatedAt as Date).getTime()).toBe((r.createdAt as Date).getTime());
  });
});
