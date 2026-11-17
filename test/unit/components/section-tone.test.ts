/**
 * #1164: färgton per avdelning — rubrikradens klasser.
 * #1636: ett steg starkare i ljust läge; mörkt läge oförändrat via `section-header`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";
import { sectionHeaderClass, type SectionTone } from "@/components/ui/section-tone";

const COLORED: Exclude<SectionTone, "gray">[] = ["red", "amber", "blue", "purple", "green", "indigo", "orange"];
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Deklarationen (`{ … }`) för en exakt selektor i en selektorlista, eller null. */
function declarationOf(selector: string): string | null {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = (m[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((s) => s.trim());
    if (selectors.includes(selector)) return (m[2] ?? "").trim();
  }
  return null;
}

describe("sectionHeaderClass", () => {
  it("ton ger bakgrund, kant och vänsterkant i avdelningens färg + standardlayout", () => {
    const c = sectionHeaderClass("blue");
    expect(c).toContain("bg-blue-200");
    expect(c).toContain("border-l-4");
    expect(c).toContain("border-l-blue-600");
    expect(c).toContain("flex items-center justify-between");
  });

  it("egen layout ersätter standardlayouten", () => {
    const c = sectionHeaderClass("purple", "flex flex-wrap gap-2");
    expect(c).toContain("flex flex-wrap gap-2");
    expect(c).not.toContain("justify-between");
  });

  it("alla toner har egna klasser", () => {
    const tones: SectionTone[] = [...COLORED, "gray"];
    for (const t of tones) expect(sectionHeaderClass(t)).toContain(`border-l-${t}-`);
  });

  for (const t of COLORED) {
    it(`${t}: ett steg starkare (bg-200, kant-300, vänsterkant-600)`, () => {
      const classes = sectionHeaderClass(t).split(" ");
      for (const c of [`bg-${t}-200`, `border-${t}-300`, `border-l-${t}-600`, "section-header"]) expect(classes).toContain(c);
      for (const c of [`bg-${t}-100`, `border-${t}-200`, `border-l-${t}-500`]) expect(classes).not.toContain(c);
    });
  }

  it("gray: ett steg starkare (bg-gray-200, kant gray-300, vänsterkant gray-500)", () => {
    const classes = sectionHeaderClass("gray").split(" ");
    for (const c of ["bg-gray-200", "border-gray-300", "border-l-gray-500", "section-header"]) expect(classes).toContain(c);
  });
});

describe("rubrikraden i mörkt läge (#1636)", () => {
  for (const t of [...COLORED, "gray"] as const) {
    it(`${t}: samma bakgrund och kant som förut (bg-100/border-200)`, () => {
      const bg = declarationOf(`.dark .section-header.bg-${t}-200`);
      expect(bg).not.toBeNull();
      expect(bg).toBe(declarationOf(`.dark .bg-${t}-100`));
      const border = declarationOf(`.dark .section-header.border-${t}-300`);
      expect(border).not.toBeNull();
      expect(border).toBe(declarationOf(`.dark .border-${t}-200`));
    });
  }
});
