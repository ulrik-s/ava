/**
 * Mallredigerarens lista (#2119) mot kontexten: varje variabel i listan
 * fylls i för ett fullt ifyllt ärende, och hjälpfunktionernas beskrivningar
 * hålls ihop med `TEMPLATE_HELPERS` av typen.
 */

import { describe, it, expect } from "vitest-compat";
import { renderHandlebars, TEMPLATE_HELPERS } from "@/lib/client/kostnadsrakning/render-handlebars";
import { buildTemplateContext } from "@/lib/client/templates/build-template-context";
import {
  TEMPLATE_HELPER_DESCRIPTIONS, TEMPLATE_HELPER_GROUP, TEMPLATE_VARIABLES, type TemplateHelperName,
} from "@/lib/client/templates/template-variables";
import { FULL } from "../../../helpers/template-context-fixture";
import { buildSeed } from "@/../tooling/scripts/seed-data";

const ctx = buildTemplateContext(FULL);

/** Nycklarna som är listor: de som står före `[i].` i någon annan nyckel. */
const ALL_KEYS = TEMPLATE_VARIABLES.flatMap((g) => g.vars.map((v) => v.key));
const LIST_KEYS = new Set(ALL_KEYS.filter((k) => ALL_KEYS.some((other) => other.startsWith(`${k}[i].`))));

/** Mallen som prövar en nyckel: skalär `{{a.b}}`, listfält `{{#each a}}{{b}}{{/each}}`, lista `{{#each a}}x{{/each}}`. */
function templateFor(key: string): string {
  const [list = "", field] = key.split("[i].");
  if (field !== undefined) return `{{#each ${list}}}{{${field}}}{{/each}}`;
  return LIST_KEYS.has(key) ? `{{#each ${key}}}x{{/each}}` : `{{${key}}}`;
}

/** Kastar med nyckelns namn när den blir tom mot kontexten. */
function assertFilled(key: string, context: Record<string, unknown>): void {
  if (renderHandlebars(templateFor(key), context).trim() === "") throw new Error(`Variabeln ${key} fylls inte i`);
}

const dataKeys = TEMPLATE_VARIABLES.filter((g) => g.group !== TEMPLATE_HELPER_GROUP).flatMap((g) => g.vars.map((v) => v.key));

describe("TEMPLATE_VARIABLES mot buildTemplateContext (#2119)", () => {
  it("grupperna, utan Tid & Utlägg", () => {
    expect(TEMPLATE_VARIABLES.map((g) => g.group)).toEqual(["Ärende", "Organisation", "Parter", "Övrigt", "Hjälpfunktioner"]);
  });

  it.each(dataKeys)("%s fylls i för ett fullt ifyllt ärende", (key) => {
    expect(() => assertFilled(key, ctx)).not.toThrow();
  });

  it("en nyckel som inte finns i kontexten fäller med sitt namn", () => {
    expect(() => assertFilled("matter.finnsInte", ctx)).toThrow("Variabeln matter.finnsInte fylls inte i");
    expect(() => assertFilled("timeEntries[i].description", ctx)).toThrow("timeEntries[i].description");
  });

  it("listorna prövas som loopar", () => {
    expect([...LIST_KEYS].sort()).toEqual(["contacts", "organization.offices"]);
    expect(templateFor("contacts")).toBe("{{#each contacts}}x{{/each}}");
    expect(templateFor("contacts[i].name")).toBe("{{#each contacts}}{{name}}{{/each}}");
  });
});

describe("hjälpfunktionerna (#2119)", () => {
  it("en rad per hjälpfunktion i TEMPLATE_HELPERS, med exempel och beskrivning", () => {
    const helpers = TEMPLATE_VARIABLES.find((g) => g.group === TEMPLATE_HELPER_GROUP)?.vars ?? [];
    expect(helpers).toEqual([
      { key: "{{formatDate date}}", desc: "Datum → 16 april 2026" },
      { key: "{{formatDateShort date}}", desc: "Datum → 2026-04-16" },
      { key: "{{formatAmount amountInOre}}", desc: "Öre → 1 250,00 kr" },
      { key: "{{formatHours minutes}}", desc: "Minuter → decimaltimmar, 90 → 1,5" },
    ]);
    expect(Object.keys(TEMPLATE_HELPER_DESCRIPTIONS).sort()).toEqual(Object.keys(TEMPLATE_HELPERS).sort());
  });

  it("en beskrivning för en hjälpfunktion som inte finns är ett typfel", () => {
    // @ts-expect-error -- formatFinnsInte finns inte i TEMPLATE_HELPERS
    const wrong: Record<TemplateHelperName, string> = { ...TEMPLATE_HELPER_DESCRIPTIONS, formatFinnsInte: "x" };
    expect(Object.keys(wrong)).toContain("formatFinnsInte");
  });
});

describe("seedens mall Fullmakt (#2119)", () => {
  it("fylls i med klientens och användarens namn", () => {
    const fullmakt = buildSeed().documentTemplates.find((t) => t.name === "Fullmakt");
    if (typeof fullmakt?.content !== "string") throw new Error("seeden saknar Fullmakt");
    const html = renderHandlebars(fullmakt.content, buildTemplateContext(FULL));
    expect(html).toContain("<p>Anna Andersson ger härmed Karin Advokat rätt att företräda mig i ärende 2026-0001.</p>");
  });
});
