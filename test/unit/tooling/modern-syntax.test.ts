/**
 * Vakten mot ett bygge som skrivits om till gammal JavaScript (#1299).
 *
 * Med byggmål som Turbopack inte kände till (t.ex. Chrome 146+) skrev bygget om
 * nästan all modern syntax: 417 → 7 `class`, 2383 → 3 `??`, 1204 → 107 `async`
 * i demo-exporten — ~11 % större klient-JS, utan att något larmade. Vakten
 * räknar modern syntax i klient-JS:en och fäller när den nästan saknas.
 */
import { describe, expect, it } from "vitest-compat";
import { checkModernSyntax, countModernSyntax, MIN_MODERN_SYNTAX } from "../../../tooling/scripts/modern-syntax";

describe("countModernSyntax", () => {
  it("räknar class, ?? och async", () => {
    expect(countModernSyntax("class A{} class B{} a??b async function f(){} async()=>1")).toEqual({ class: 2, nullish: 1, async: 2 });
  });

  it("räknar inte ord som bara innehåller orden (className, asyncIterator)", () => {
    expect(countModernSyntax("x.className; Symbol.asyncIterator; subclass")).toEqual({ class: 0, nullish: 0, async: 0 });
  });
});

describe("checkModernSyntax", () => {
  const modern = `${"class A{} ".repeat(MIN_MODERN_SYNTAX)}${"a??b ".repeat(MIN_MODERN_SYNTAX)}${"async function f(){} ".repeat(MIN_MODERN_SYNTAX)}`;

  it("ett modernt bygge godkänns", () => {
    expect(checkModernSyntax(modern)).toEqual({ ok: true, counts: { class: MIN_MODERN_SYNTAX, nullish: MIN_MODERN_SYNTAX, async: MIN_MODERN_SYNTAX } });
  });

  it("nästan ingen modern syntax (bygget skrevs om) → fälls, och säger vad som saknas", () => {
    const r = checkModernSyntax("class A{} a??b function f(){ return regeneratorRuntime }");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.sort()).toEqual(["async", "class", "nullish"]);
  });

  it("en enda sort som saknas räcker för att fälla", () => {
    const noNullish = `${"class A{} ".repeat(MIN_MODERN_SYNTAX)}${"async function f(){} ".repeat(MIN_MODERN_SYNTAX)}`;
    const r = checkModernSyntax(noNullish);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["nullish"]);
  });

  it("tröskeln ligger långt under ett riktigt bygge och långt över ett omskrivet", () => {
    expect(MIN_MODERN_SYNTAX).toBeGreaterThan(7);
    expect(MIN_MODERN_SYNTAX).toBeLessThan(107);
  });
});
