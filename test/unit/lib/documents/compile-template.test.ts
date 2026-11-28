/**
 * Dokumentmotorns Handlebars-steg (#2251, ADR 0042): full Handlebars i strikt
 * läge, appens mallhjälpare plus `upper`, `pageNumber` och `pageCount`.
 */
import { describe, it, expect } from "vitest-compat";
import { compileDocumentMarkup, DOCUMENT_HELPERS } from "@/lib/client/documents/compile-template";
import { LayoutError } from "@/lib/shared/documents/markup-parser";
import { PAGE_COUNT_TOKEN, PAGE_NUMBER_TOKEN } from "@/lib/shared/documents/template-source";
import { formatKr } from "@/lib/shared/kr-format";

const compile = (template: string, context: object, partials: Record<string, string> = {}): string =>
  compileDocumentMarkup({ template, partials }, context);

describe("compileDocumentMarkup", () => {
  it("escapar värden så att de aldrig blir element", () => {
    expect(compile("<text>{{v}}</text>", { v: `<rule/> & "x"` })).toBe("<text>&lt;rule/&gt; &amp; &quot;x&quot;</text>");
  });

  it("hjälpfunktionerna: upper, formatAmount och sidnumren", () => {
    expect(compile("{{upper h}}|{{formatAmount ore}}|{{pageNumber}}/{{pageCount}}", { h: "Rådgivningsfaktura", ore: 125_000 }))
      .toBe(`RÅDGIVNINGSFAKTURA|${formatKr(125_000)}|${PAGE_NUMBER_TOKEN}/${PAGE_COUNT_TOKEN}`);
    expect(DOCUMENT_HELPERS.upper(42)).toBe("");
  });

  it("partials med parametrar; partial-objektet ändras inte", () => {
    const partials = { rubrik: "<text>{{upper titel}} {{nr}}</text>" };
    expect(compile(`{{> rubrik titel=h}}`, { h: "faktura", nr: "F-1" }, partials)).toBe("<text>FAKTURA F-1</text>");
    expect(partials).toEqual({ rubrik: "<text>{{upper titel}} {{nr}}</text>" });
  });

  it("strikt läge: ett fält som saknas är ett fel, inte tom text", () => {
    expect(() => compile("{{saknas}}", {})).toThrow(LayoutError);
    expect(() => compile("{{saknas}}", {})).toThrow(/Mallen kunde inte renderas: "saknas" not defined/);
  });

  it("syntaxfel och saknade partials blir LayoutError", () => {
    expect(() => compile("{{#if x}}", { x: true })).toThrow(/Mallen kunde inte renderas/);
    expect(() => compile("{{> finnsinte}}", {})).toThrow(/finnsinte/);
  });
});
