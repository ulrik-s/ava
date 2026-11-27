/**
 * Test för utils.ts — cn() för class-merging.
 */

import { describe, it, expect } from "vitest-compat";
import { cn } from "@/lib/client/utils";

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
