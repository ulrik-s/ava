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
import { formatKr } from "@/lib/shared/format-kr";
import { toIsoDate, toSwedishLongDate } from "@/lib/shared/iso-date";
import { formatDecimalHours } from "@/lib/shared/kr-format";

/**
 * Ett giltigt datum ur ett mallvärde, annars `undefined`: tomt, ogiltigt eller
 * Handlebars options-objekt (hjälpfunktionen anropad utan argument).
 * Formaterarna kastar `RangeError` vid ogiltigt datum, så kontrollen sker här.
 */
function templateDate(value: unknown): Date | string | undefined {
  if (!(value instanceof Date) && typeof value !== "string") return undefined;
  return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}

/** Ett ändligt öresbelopp ur ett mallvärde (tal eller sifferträng), annars `undefined`. */
function templateOre(value: unknown): number | undefined {
  const isAmount = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
  const ore = isAmount ? Number(value) : Number.NaN;
  return Number.isFinite(ore) ? ore : undefined;
}

/** Datumet formaterat med `format`, eller tom text när värdet inte är ett datum. */
function formatTemplateDate(value: unknown, format: (d: Date | string) => string): string {
  const date = templateDate(value);
  return date === undefined ? "" : format(date);
}

/**
 * Hjälpfunktioner som mallredigeraren dokumenterar. Skickas per anrop (inte
 * `registerHelper`), så att ingen global Handlebars-state ändras.
 * - `{{formatDate d}}` → datum i ord i svensk tid ("16 april 2026").
 * - `{{formatDateShort d}}` → `ÅÅÅÅ-MM-DD` i svensk tid.
 * - `{{formatAmount öre}}` → kronor ("1 250,00 kr").
 * - `{{formatHours minutes}}` → decimaltimmar som i resten av appen (#1543).
 *
 * Ett tomt eller ogiltigt värde ger tom text, inget fel.
 */
export const TEMPLATE_HELPERS = {
  formatDate: (value: unknown): string => formatTemplateDate(value, toSwedishLongDate),
  formatDateShort: (value: unknown): string => formatTemplateDate(value, toIsoDate),
  formatAmount: (value: unknown): string => {
    const ore = templateOre(value);
    return ore === undefined ? "" : formatKr(ore);
  },
  formatHours: (minutes: unknown): string => formatDecimalHours(Number(minutes)),
};

export function renderHandlebars(template: string, context: Record<string, unknown>): string {
  return Handlebars.compile(template)(context, { helpers: TEMPLATE_HELPERS });
}
