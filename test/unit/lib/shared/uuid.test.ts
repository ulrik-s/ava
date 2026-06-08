/**
 * ADR 0003 — app-genererad UUIDv7 + deterministisk seed-id (v5-stil).
 */

import { describe, it, expect } from "vitest-compat";
import { uuidv7, isUuid } from "@/lib/shared/uuid";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("har giltigt UUID-format", () => {
    expect(uuidv7()).toMatch(UUID_RE);
  });

  it("har version 7 (nibble efter andra bindestrecket)", () => {
    // 8-4-4-4-12 → versionsnibblen är första tecknet i tredje gruppen
    const v = uuidv7().split("-")[2]![0];
    expect(v).toBe("7");
  });

  it("har RFC-variant (8/9/a/b i fjärde gruppen)", () => {
    const variant = uuidv7().split("-")[3]![0];
    expect(["8", "9", "a", "b"]).toContain(variant);
  });

  it("är unik över många anrop", () => {
    const set = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(set.size).toBe(1000);
  });

  it("är tidsordnad — senare anrop sorterar lexikografiskt >= tidigare", () => {
    // v7:s 48-bit timestamp-prefix → monotont stigande per ms. Vi mockar
    // inte klockan; istället jämför vi prefix för id:n tagna i sekvens där
    // tiden inte minskar.
    const a = uuidv7();
    const b = uuidv7();
    // Timestamp-prefixet (första 48 bitar = 12 hex) ska inte minska.
    const pa = a.replace(/-/g, "").slice(0, 12);
    const pb = b.replace(/-/g, "").slice(0, 12);
    expect(pb >= pa).toBe(true);
  });
});

describe("isUuid", () => {
  it("känner igen ett giltigt uuid", () => {
    expect(isUuid(uuidv7())).toBe(true);
  });
  it("avvisar slug/skräp", () => {
    expect(isUuid("m-001-vardnad")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("inte-ett-uuid")).toBe(false);
  });
});
