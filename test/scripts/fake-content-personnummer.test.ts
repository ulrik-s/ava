/**
 * Demotexternas personnummer (#1362) är Skatteverkets testpersonnummer — aldrig
 * ett nummer som kan tillhöra en verklig person. Listan nedan är hämtad ur
 * Skatteverkets öppna data ("Testpersonnummer", dataportal.se); lägg till där
 * innan ett nytt nummer används i en demotext.
 */
import { describe, expect, it } from "vitest-compat";
import { bodyOf, DOC_TEMPLATES } from "../../tooling/demo-generator/simulate/fake-content";

const SKATTEVERKET_TEST_NUMBERS = new Set([
  "800426-2385", "810822-2384", "820421-2396", "830817-2397", "840415-2392",
  "850812-2382", "861209-2380", "870815-2387", "880420-2383",
]);

/** Personnummer (ÅÅMMDD-NNNN) — organisationsnummer börjar på 5 och räknas inte. */
const PERSONNUMMER = /\b[0-46-9]\d{5}-\d{4}\b/g;

describe("demotexternas personnummer (#1362)", () => {
  it("varje personnummer i varje mall är ett testpersonnummer", () => {
    const found = new Set<string>();
    for (const template of Object.values(DOC_TEMPLATES)) {
      for (let seed = 0; seed < 20; seed++) {
        for (const criminal of [false, true]) {
          const body = bodyOf(template, { at: new Date("2026-03-02"), seed, criminal }) ?? "";
          for (const pnr of body.match(PERSONNUMMER) ?? []) found.add(pnr);
        }
      }
    }
    expect(found.size).toBeGreaterThan(0);
    expect([...found].filter((p) => !SKATTEVERKET_TEST_NUMBERS.has(p))).toEqual([]);
  });
});
