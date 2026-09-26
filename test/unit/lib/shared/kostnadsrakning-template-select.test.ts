/**
 * Template-val baserat på taxa-läget:
 *   taxa-ärende    → KOSTNADSRAKNING_TEMPLATE_CATEGORY + DEFAULT_HTML
 *   icke-taxa      → KOSTNADSRAKNING_ICKE_TAXA_TEMPLATE_CATEGORY + (samma) DEFAULT_HTML
 *
 * Sedan #1218 delar båda varianterna samma layout; vad arvodet står på avgörs
 * av contexten (dokumentvyn), inte av vilken mall som väljs.
 *
 * Buggen som tdd-testet låser fast: tidigare hämtades alltid taxa-mallen
 * oavsett isTaxe, så icke-taxa-kostnadsräkningar fick en mall som visade
 * "Brottmålstaxa nivå X" och en taxa-tabell istället för timkostnadsnorm-
 * specifikationen.
 */
import { describe, it, expect } from "vitest-compat";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";
import {
  KOSTNADSRAKNING_TEMPLATE_CATEGORY,
  KOSTNADSRAKNING_ICKE_TAXA_TEMPLATE_CATEGORY,
  KOSTNADSRAKNING_DEFAULT_HTML,
  templateCategoryFor,
  defaultTemplateFor,
} from "@/lib/shared/kostnadsrakning-template";

describe("templateCategoryFor", () => {
  it("taxa → 'Kostnadsräkning'-kategorin", () => {
    expect(templateCategoryFor(true)).toBe(KOSTNADSRAKNING_TEMPLATE_CATEGORY);
  });
  it("icke-taxa → 'Kostnadsräkning (icke-taxa)'-kategorin", () => {
    expect(templateCategoryFor(false)).toBe(KOSTNADSRAKNING_ICKE_TAXA_TEMPLATE_CATEGORY);
  });
});

describe("defaultTemplateFor", () => {
  it("taxa och icke-taxa delar default-mallen (samma layout, #1218)", () => {
    expect(defaultTemplateFor(true)).toBe(KOSTNADSRAKNING_DEFAULT_HTML);
    expect(defaultTemplateFor(false)).toBe(KOSTNADSRAKNING_DEFAULT_HTML);
  });
  it("taxans rubrik kommer ur contexten: taxa-ärende visar brottmålstaxan, icke-taxa gör det inte", () => {
    const base = {
      matter: { matterNumber: "X-1", title: "Syntetiskt" }, defender: { name: "Test Testsson" }, expenses: [],
      hufStart: new Date("2026-05-20T09:00:00"), hufEnd: new Date("2026-05-20T11:00:00"),
    };
    const taxa = renderHandlebars(defaultTemplateFor(true), buildKostnadsrakningContext({ ...base, isTaxeArende: true }).templateContext);
    const lopande = renderHandlebars(defaultTemplateFor(false), buildKostnadsrakningContext({ ...base, isTaxeArende: false }).templateContext);
    expect(taxa).toContain("Brottmålstaxa (DVFS 2025:6)");
    expect(taxa).toContain("ARVODE ENLIGT BROTTMÅLSTAXAN");
    expect(lopande).not.toContain("Brottmålstaxa");
    expect(lopande).toMatch(/ARVODE<\/td><td class="num">2,00 á /);
  });
});

describe("default-mallen ritar dokumentvyn (#1218)", () => {
  it("sammanställning + arbetsredogörelse ur document.*", () => {
    expect(KOSTNADSRAKNING_DEFAULT_HTML).toMatch(/{{#each summaryRows}}/);
    expect(KOSTNADSRAKNING_DEFAULT_HTML).toMatch(/{{#each specSections}}/);
    expect(KOSTNADSRAKNING_DEFAULT_HTML).toMatch(/ARBETSREDOGÖRELSE/);
    expect(KOSTNADSRAKNING_DEFAULT_HTML).toMatch(/counter\(page\)/);
  });
});
