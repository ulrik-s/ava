/**
 * Tester för klient-utils. Fokus: pluralChanges (delad sv-pluralisering, #6).
 */
import { describe, it, expect } from "vitest-compat";
import { pluralChanges, formatCurrency } from "@/lib/client/utils";

describe("pluralChanges", () => {
  it("singular vid exakt 1", () => {
    expect(pluralChanges(1)).toBe("ändring");
  });
  it("plural vid 0 och >1", () => {
    expect(pluralChanges(0)).toBe("ändringar");
    expect(pluralChanges(2)).toBe("ändringar");
    expect(pluralChanges(42)).toBe("ändringar");
  });
});

describe("formatCurrency", () => {
  it("öre → SEK-format", () => {
    expect(formatCurrency(150000)).toMatch(/1\s?500/);
  });
});
