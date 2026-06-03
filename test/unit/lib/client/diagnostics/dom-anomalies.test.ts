/**
 * Tester för `detectDomAnomalies` — upptäcker DOM-muterande tillägg som kan
 * orsaka React #418 hydrerings-mismatch, så felrapporten pekar ut orsaken.
 */

import { describe, it, expect } from "vitest";
import { detectDomAnomalies } from "@/lib/client/diagnostics/dom-anomalies";

function doc(opts: {
  htmlAttrs?: string[]; bodyAttrs?: string[]; htmlClass?: string;
  bodyKids?: Array<{ tagName: string }>; selectors?: string[];
}): Parameters<typeof detectDomAnomalies>[0] {
  const sel = new Set(opts.selectors ?? []);
  return {
    documentElement: { getAttributeNames: () => opts.htmlAttrs ?? [], className: opts.htmlClass ?? "" },
    body: { getAttributeNames: () => opts.bodyAttrs ?? [], children: opts.bodyKids ?? [] },
    querySelector: (s: string) => (sel.has(s) ? {} : null),
  };
}

describe("detectDomAnomalies", () => {
  it("ren sida → tom sträng", () => {
    expect(detectDomAnomalies(doc({ bodyKids: [{ tagName: "SCRIPT" }, { tagName: "DIV" }] }))).toBe("");
  });

  it("upptäcker Dark Reader via html-attribut", () => {
    const r = detectDomAnomalies(doc({ htmlAttrs: ["lang", "data-darkreader-mode"] }));
    expect(r).toContain("Dark Reader");
    expect(r).toContain("html-attr: data-darkreader-mode");
  });

  it("upptäcker Grammarly via body-attribut + injicerat element", () => {
    const r = detectDomAnomalies(doc({
      bodyAttrs: ["data-gr-ext-installed"],
      bodyKids: [{ tagName: "DIV" }, { tagName: "GRAMMARLY-DESKTOP-INTEGRATION" }],
    }));
    expect(r).toContain("Grammarly");
    expect(r).toContain("extra body-barn: GRAMMARLY-DESKTOP-INTEGRATION");
  });

  it("upptäcker Google Translate via html-class", () => {
    expect(detectDomAnomalies(doc({ htmlClass: "translated-ltr" }))).toContain("Google Translate");
  });

  it("upptäcker okänt tillägg via injicerat toppnivå-element", () => {
    const r = detectDomAnomalies(doc({ bodyKids: [{ tagName: "DIV" }, { tagName: "SOME-EXT-WIDGET" }] }));
    expect(r).toContain("extra body-barn: SOME-EXT-WIDGET");
  });

  it("är defensiv mot null/trasigt document", () => {
    expect(detectDomAnomalies(null)).toBe("");
    expect(detectDomAnomalies(undefined)).toBe("");
  });
});
