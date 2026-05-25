/**
 * Tester för mini-Handlebars-renderaren.
 */

import { describe, it, expect } from "vitest";
import { renderHandlebars } from "@/client/lib/kostnadsrakning/render-handlebars";

describe("renderHandlebars", () => {
  it("ersätter enkla variabler", () => {
    expect(renderHandlebars("Hej {{name}}!", { name: "Anna" })).toBe("Hej Anna!");
  });

  it("följer dot-paths", () => {
    expect(renderHandlebars("Mål {{matter.number}}", { matter: { number: "2026-0001" } }))
      .toBe("Mål 2026-0001");
  });

  it("saknad variabel → tom sträng", () => {
    expect(renderHandlebars("Hej {{name}}!", {})).toBe("Hej !");
  });

  it("escapar HTML i värden", () => {
    expect(renderHandlebars("{{x}}", { x: "<script>alert('xss')</script>" }))
      .toBe("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  it("{{#if}} visar block när truthy", () => {
    expect(renderHandlebars("{{#if shown}}A{{/if}}", { shown: true })).toBe("A");
    expect(renderHandlebars("{{#if shown}}A{{/if}}", { shown: false })).toBe("");
    expect(renderHandlebars("{{#if x}}A{{/if}}", { x: "hej" })).toBe("A");
    expect(renderHandlebars("{{#if x}}A{{/if}}", { x: "" })).toBe("");
    expect(renderHandlebars("{{#if x}}A{{/if}}", { x: [] })).toBe("");
    expect(renderHandlebars("{{#if x}}A{{/if}}", { x: [1] })).toBe("A");
  });

  it("{{#each}} itererar over array", () => {
    const out = renderHandlebars(
      "{{#each items}}[{{name}}]{{/each}}",
      { items: [{ name: "a" }, { name: "b" }, { name: "c" }] },
    );
    expect(out).toBe("[a][b][c]");
  });

  it("{{#each}} → tom array ger tom output", () => {
    expect(renderHandlebars("{{#each items}}X{{/each}}", { items: [] })).toBe("");
  });

  it("nästlade #each + #if", () => {
    const tpl = "{{#each xs}}{{#if shown}}{{label}};{{/if}}{{/each}}";
    const out = renderHandlebars(tpl, {
      xs: [
        { shown: true, label: "A" },
        { shown: false, label: "B" },
        { shown: true, label: "C" },
      ],
    });
    expect(out).toBe("A;C;");
  });

  it("array.length fungerar", () => {
    expect(renderHandlebars("{{items.length}} st", { items: [1, 2, 3] })).toBe("3 st");
  });

  it("parent-scope-lookup i each", () => {
    const tpl = "{{#each items}}{{title}}-{{ownerName}};{{/each}}";
    const out = renderHandlebars(tpl, {
      ownerName: "Anna",
      items: [{ title: "X" }, { title: "Y" }],
    });
    expect(out).toBe("X-Anna;Y-Anna;");
  });

  it("real-world: kostnadsräknings-utdrag", () => {
    const tpl = `Mål {{matterNumber}}
{{#if expenseLines.length}}
Utlägg:
{{#each expenseLines}}- {{date}}: {{description}} ({{vatRateLabel}}) → {{inclVatFormatted}}
{{/each}}{{/if}}
Total: {{totalInclFormatted}}`;
    const ctx = {
      matterNumber: "2026-0016",
      expenseLines: [
        { date: "2026-05-20", description: "Domstolsavgift", vatRateLabel: "0 %", inclVatFormatted: "125,00 kr" },
        { date: "2026-05-21", description: "Tåg", vatRateLabel: "6 %", inclVatFormatted: "450,00 kr" },
      ],
      totalInclFormatted: "7 619,00 kr",
    };
    const out = renderHandlebars(tpl, ctx);
    expect(out).toContain("Mål 2026-0016");
    expect(out).toContain("- 2026-05-20: Domstolsavgift (0 %) → 125,00 kr");
    expect(out).toContain("- 2026-05-21: Tåg (6 %) → 450,00 kr");
    expect(out).toContain("Total: 7 619,00 kr");
  });
});
