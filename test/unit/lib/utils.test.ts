/**
 * Test för utils.ts — cn() för class-merging, formatMinutes, formatCurrency.
 */

import { describe, it, expect } from "vitest-compat";
import { cn, formatMinutes, formatCurrency } from "@/lib/client/utils";

describe("cn()", () => {
  it("kombinerar klasser till en sträng", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("hanterar conditional via objekt", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("merger Tailwind-klasser (sista vinner)", () => {
    // tailwind-merge tar bort konflikter som px-2 vs px-4
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("hanterar undefined/null/false", () => {
    expect(cn("foo", null, undefined, false, "bar")).toBe("foo bar");
  });

  it("returnerar tom sträng utan input", () => {
    expect(cn()).toBe("");
  });
});

describe("formatMinutes()", () => {
  it("formaterar < 60 min korrekt", () => {
    expect(formatMinutes(30)).toBe("0:30");
    expect(formatMinutes(5)).toBe("0:05");
  });

  it("formaterar timmar:minuter", () => {
    expect(formatMinutes(60)).toBe("1:00");
    expect(formatMinutes(90)).toBe("1:30");
    expect(formatMinutes(125)).toBe("2:05");
  });

  it("hanterar 0", () => {
    expect(formatMinutes(0)).toBe("0:00");
  });

  it("padding på minutdelen", () => {
    expect(formatMinutes(61)).toBe("1:01");
    expect(formatMinutes(605)).toBe("10:05");
  });
});

describe("formatCurrency()", () => {
  it("formaterar öre till SEK", () => {
    const v = formatCurrency(100000); // 1000 kr
    expect(v).toContain("1");
    expect(v).toContain("000");
    expect(v).toContain("kr");
  });

  it("hanterar 0", () => {
    expect(formatCurrency(0)).toContain("0");
  });

  it("hanterar negativa belopp (kreditfaktura)", () => {
    const v = formatCurrency(-500000);
    expect(v).toContain("−"); // svensk minus eller -
    expect(v).toContain("5");
  });

  it("hanterar decimaler från ojämna ören", () => {
    const v = formatCurrency(123450); // 1234.50
    expect(v).toContain("1");
    expect(v).toContain("234");
    expect(v).toContain("50");
  });
});
