/**
 * #1164: färgton per avdelning — rubrikradens klasser.
 */
import { describe, expect, it } from "vitest-compat";
import { sectionHeaderClass, type SectionTone } from "@/components/ui/section-tone";

describe("sectionHeaderClass", () => {
  it("ton ger bakgrund, kant och vänsterkant i avdelningens färg + standardlayout", () => {
    const c = sectionHeaderClass("blue");
    expect(c).toContain("bg-blue-100");
    expect(c).toContain("border-l-4");
    expect(c).toContain("border-l-blue-500");
    expect(c).toContain("flex items-center justify-between");
  });

  it("egen layout ersätter standardlayouten", () => {
    const c = sectionHeaderClass("purple", "flex flex-wrap gap-2");
    expect(c).toContain("flex flex-wrap gap-2");
    expect(c).not.toContain("justify-between");
  });

  it("alla toner har egna klasser", () => {
    const tones: SectionTone[] = ["red", "amber", "blue", "purple", "green", "indigo", "orange", "gray"];
    for (const t of tones) expect(sectionHeaderClass(t)).toContain(`border-l-${t}-`);
  });
});
