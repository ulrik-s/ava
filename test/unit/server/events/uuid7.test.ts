import { describe, it, expect } from "vitest";
import { uuidv7 } from "@/lib/server/events/uuid7";

describe("uuidv7", () => {
  it("genererar en 36-tecken UUID-sträng med v7-versionsbit", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("ger kronologiskt sorterbara id:n (senare > tidigare lex)", async () => {
    const a = uuidv7();
    await new Promise((r) => setTimeout(r, 5));
    const b = uuidv7();
    expect(a < b).toBe(true);
  });

  it("ger unika id:n även när de genereras i snabb följd", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(uuidv7());
    expect(ids.size).toBe(1000);
  });
});
