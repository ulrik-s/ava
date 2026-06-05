"use client";

/**
 * `renderHandlebars` — renderar en Handlebars-mall mot en kontext med det
 * **fulla** `handlebars`-biblioteket, **statiskt importerat** (inga dynamiska
 * imports). Bundle-storlek är underordnat full mall-fidelitet.
 *
 * Ersatte tidigare en egen mini-renderer (bara `{{var}}`/`{{#if}}`/`{{#each}}`).
 * Full Handlebars ger helpers, partials, `{{{oescapat}}}`, kommentarer m.m.
 * som byrå-författade mallar kan behöva.
 *
 * OBS standard-Handlebars-semantik: parent-scope inuti `{{#each}}` nås via
 * `{{../var}}` (den gamla mini-renderern gjorde det implicit).
 */

import Handlebars from "handlebars";

export function renderHandlebars(template: string, context: Record<string, unknown>): string {
  return Handlebars.compile(template)(context);
}
