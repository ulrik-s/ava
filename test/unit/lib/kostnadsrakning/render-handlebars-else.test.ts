/**
 * Testbatteri för renderHandlebars — fokus på {{else}}, nästling och
 * edge-cases som tidigare gav "saker kommer inte med i PDF:en".
 *
 * Bug: {{#if x}}A{{else}}B{{/if}} stöddes inte → om x falsy försvann HELA
 * blocket (inkl else-grenen). Kostnadsräknings-mallen använder {{else}}
 * efter {{#if taxaApplies}} → för frångångstaxa (HUF>225) försvann allt.
 */

import { describe, it, expect } from "vitest-compat";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";

describe("renderHandlebars — {{else}}", () => {
  it("if-truthy → if-grenen, inte else", () => {
    const out = renderHandlebars("{{#if x}}JA{{else}}NEJ{{/if}}", { x: true });
    expect(out).toBe("JA");
  });

  it("if-falsy → else-grenen", () => {
    const out = renderHandlebars("{{#if x}}JA{{else}}NEJ{{/if}}", { x: false });
    expect(out).toBe("NEJ");
  });

  it("if-falsy utan else → tom sträng", () => {
    const out = renderHandlebars("{{#if x}}JA{{/if}}", { x: false });
    expect(out).toBe("");
  });

  it("else-gren renderar variabler", () => {
    const out = renderHandlebars("{{#if applies}}{{a}}{{else}}Faller tillbaka: {{b}}{{/if}}", { applies: false, a: "X", b: "löpande räkning" });
    expect(out).toBe("Faller tillbaka: löpande räkning");
  });

  it("if-truthy lämnar INTE kvar {{else}}-token eller else-text", () => {
    const out = renderHandlebars("{{#if x}}JA{{else}}NEJ{{/if}}", { x: true });
    expect(out).not.toContain("else");
    expect(out).not.toContain("NEJ");
  });
});

describe("renderHandlebars — nästling", () => {
  it("nästlade if (inre else hör till inre if)", () => {
    const tpl = "{{#if a}}A{{#if b}}B{{else}}notB{{/if}}{{else}}notA{{/if}}";
    expect(renderHandlebars(tpl, { a: true, b: true })).toBe("AB");
    expect(renderHandlebars(tpl, { a: true, b: false })).toBe("AnotB");
    expect(renderHandlebars(tpl, { a: false, b: true })).toBe("notA");
  });

  it("if med else inuti each", () => {
    const tpl = "{{#each items}}{{name}}:{{#if ok}}+{{else}}-{{/if}} {{/each}}";
    const out = renderHandlebars(tpl, { items: [{ name: "a", ok: true }, { name: "b", ok: false }] });
    expect(out).toBe("a:+ b:- ");
  });

  it("each med inre variabel + parent-scope-lookup (../)", () => {
    const tpl = "{{#each lines}}{{desc}} ({{../currency}}){{/each}}";
    const out = renderHandlebars(tpl, { currency: "SEK", lines: [{ desc: "Taxi" }, { desc: "Tåg" }] });
    expect(out).toBe("Taxi (SEK)Tåg (SEK)");
  });
});

describe("renderHandlebars — edge cases", () => {
  it("hanterar mellanrum inuti {{ x }}", () => {
    const out = renderHandlebars("{{ name }}", { name: "Anna" });
    expect(out).toBe("Anna");
  });

  it("hanterar mellanrum i block-helpers {{#if x }}", () => {
    const out = renderHandlebars("{{#if  x }}JA{{ else }}NEJ{{/if }}", { x: false });
    expect(out).toBe("NEJ");
  });

  it(".length på array", () => {
    const out = renderHandlebars("{{#if lines.length}}{{lines.length}} rader{{/if}}", { lines: [1, 2, 3] });
    expect(out).toBe("3 rader");
  });

  it("saknad variabel → tom, inte 'undefined'", () => {
    const out = renderHandlebars("X{{saknas}}Y", {});
    expect(out).toBe("XY");
  });

  it("HTML-escapar farliga tecken", () => {
    const out = renderHandlebars("{{x}}", { x: "<script>" });
    expect(out).toContain("&lt;script&gt;");
  });
});
