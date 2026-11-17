/**
 * #1164: färgton per avdelning — rubrikradens klasser.
 * #1636: ett steg starkare i ljust läge, mörkt läge oförändrat via `section-tone-*`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";
import { sectionHeaderClass, type SectionTone } from "@/components/ui/section-tone";

const TONES: readonly SectionTone[] = ["red", "amber", "blue", "purple", "green", "indigo", "orange", "gray"];

describe("sectionHeaderClass", () => {
  it("ton ger bakgrund, kant och vänsterkant i avdelningens färg + standardlayout", () => {
    const c = sectionHeaderClass("blue");
    expect(c).toContain("bg-blue-200");
    expect(c).toContain("border-blue-300");
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
    for (const t of TONES) expect(sectionHeaderClass(t)).toContain(`border-l-${t}-`);
  });

  it("varje färgad ton är ett steg starkare: 200-bakgrund, 300-kant, 600-vänsterkant", () => {
    for (const t of TONES.filter((x) => x !== "gray")) {
      const classes = sectionHeaderClass(t).split(" ");
      expect(classes).toEqual(expect.arrayContaining([`bg-${t}-200`, `border-${t}-300`, `border-l-${t}-600`]));
      expect(classes).not.toContain(`bg-${t}-100`);
    }
  });

  it("grått motsvarande: gray-200, gray-300, gray-500", () => {
    const classes = sectionHeaderClass("gray").split(" ");
    expect(classes).toEqual(expect.arrayContaining(["bg-gray-200", "border-gray-300", "border-l-gray-500"]));
    expect(classes).not.toContain("bg-gray-100");
  });

  it("varje ton bär sin mörka-läget-klass", () => {
    for (const t of TONES) expect(sectionHeaderClass(t).split(" ")).toContain(`section-tone-${t}`);
  });
});

describe("mörkt läge för rubrikraderna (globals.css)", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const rule = (selector: string): string => {
    const open = css.indexOf(`${selector} {`);
    if (open < 0) return "";
    const start = open + selector.length + 2;
    return css.slice(start, css.indexOf("}", start));
  };
  const decl = (body: string, prop: string): string => body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1]?.trim() ?? "";

  it("varje ton får samma bakgrund och kant som dagens bg-*-100 / border-*-200", () => {
    for (const t of TONES) {
      const own = rule(`.dark .section-tone-${t}`);
      expect(decl(own, "background-color")).not.toBe("");
      expect(decl(own, "background-color")).toBe(decl(rule(`.dark .bg-${t}-100`), "background-color"));
      expect(decl(own, "border-color")).toBe(decl(rule(`.dark .border-${t}-200`), "border-color"));
    }
  });

  it("reglerna står efter .dark .bg-gray-200 och .dark .border-gray-300 (lika specificitet, senast vinner)", () => {
    const at = css.indexOf(".dark .section-tone-gray");
    expect(at).toBeGreaterThan(css.indexOf(".dark .bg-gray-200"));
    expect(at).toBeGreaterThan(css.indexOf(".dark .border-gray-300"));
  });
});
