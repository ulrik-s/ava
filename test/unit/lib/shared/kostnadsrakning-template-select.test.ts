/**
 * Template-val baserat på taxa-läget:
 *   taxa-ärende    → KOSTNADSRAKNING_TEMPLATE_CATEGORY + DEFAULT_HTML
 *   icke-taxa      → KOSTNADSRAKNING_ICKE_TAXA_TEMPLATE_CATEGORY + ICKE_TAXA_DEFAULT_HTML
 *
 * Buggen som tdd-testet låser fast: tidigare hämtades alltid taxa-mallen
 * oavsett isTaxe, så icke-taxa-kostnadsräkningar fick en mall som visade
 * "Brottmålstaxa nivå X" och en taxa-tabell istället för timkostnadsnorm-
 * specifikationen.
 */
import { describe, it, expect } from "vitest-compat";
import {
  KOSTNADSRAKNING_TEMPLATE_CATEGORY,
  KOSTNADSRAKNING_ICKE_TAXA_TEMPLATE_CATEGORY,
  KOSTNADSRAKNING_DEFAULT_HTML,
  KOSTNADSRAKNING_ICKE_TAXA_DEFAULT_HTML,
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
  it("taxa → DEFAULT_HTML med 'Brottmålstaxa'-rubrik", () => {
    expect(defaultTemplateFor(true)).toBe(KOSTNADSRAKNING_DEFAULT_HTML);
    expect(defaultTemplateFor(true)).toMatch(/Brottmålstaxa/);
  });
  it("icke-taxa → ICKE_TAXA_DEFAULT_HTML med 'Timkostnadsnorm'-rubrik (inte taxa)", () => {
    expect(defaultTemplateFor(false)).toBe(KOSTNADSRAKNING_ICKE_TAXA_DEFAULT_HTML);
    expect(defaultTemplateFor(false)).toMatch(/Timkostnadsnorm/);
    expect(defaultTemplateFor(false)).not.toMatch(/Brottmålstaxa \(DVFS/);
  });
});

describe("icke-taxa-template ska visa tidsspecifikationen", () => {
  it("innehåller timeLines-loop + summering med Total arbetstid", () => {
    expect(KOSTNADSRAKNING_ICKE_TAXA_DEFAULT_HTML).toMatch(/{{#each timeLines}}/);
    expect(KOSTNADSRAKNING_ICKE_TAXA_DEFAULT_HTML).toMatch(/Total arbetstid/);
    expect(KOSTNADSRAKNING_ICKE_TAXA_DEFAULT_HTML).toMatch(/totalArbetsFormatted/);
  });
  it("innehåller INTE taxaIntervalLabel (det är taxa-only)", () => {
    expect(KOSTNADSRAKNING_ICKE_TAXA_DEFAULT_HTML).not.toMatch(/taxaIntervalLabel/);
  });
});
