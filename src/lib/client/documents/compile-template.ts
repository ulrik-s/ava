"use client";

/**
 * Dokumentmotorns Handlebars-steg (ADR 0042): mall + partials + kontext →
 * layoutmarkering. Samma fulla Handlebars och samma hjälpfunktioner som byråns
 * HTML-mallar (`TEMPLATE_HELPERS`), plus det dokumenten behöver:
 * - `{{upper text}}` → versaler ("FAKTURA"),
 * - `{{pageNumber}}` / `{{pageCount}}` → sidnummer och sidantal (bara i
 *   `<page-header>`/`<page-footer>`, där renderaren känner sidantalet).
 *
 * Mallen kompileras i strikt läge: ett fält som inte finns i kontexten är ett
 * fel med rad och kolumn, inte en tyst tom sträng. Ingen global Handlebars-
 * state ändras — hjälpfunktioner och partials skickas per anrop.
 */

import Handlebars from "handlebars";
import { TEMPLATE_HELPERS } from "@/lib/client/kostnadsrakning/render-handlebars";
import { LayoutError } from "@/lib/shared/documents/markup-parser";
import { PAGE_COUNT_TOKEN, PAGE_NUMBER_TOKEN, type DocumentTemplateSource } from "@/lib/shared/documents/template-source";

/** Dokumentmallarnas hjälpfunktioner. */
export const DOCUMENT_HELPERS = {
  ...TEMPLATE_HELPERS,
  upper: (value: unknown): string => (typeof value === "string" ? value.toUpperCase() : ""),
  pageNumber: (): string => PAGE_NUMBER_TOKEN,
  pageCount: (): string => PAGE_COUNT_TOKEN,
};

/**
 * Rendera mallen till layoutmarkering. Handlebars-fel (syntax, okänt fält,
 * saknad partial) blir `LayoutError`.
 */
export function compileDocumentMarkup(source: DocumentTemplateSource, context: object): string {
  try {
    // Handlebars kompilerar partials som strängar och sparar dem i objektet → en kopia per anrop.
    return Handlebars.compile(source.template, { strict: true })(context, { helpers: DOCUMENT_HELPERS, partials: { ...source.partials } });
  } catch (error) {
    throw new LayoutError(`Mallen kunde inte renderas: ${error instanceof Error ? error.message : String(error)}`);
  }
}
