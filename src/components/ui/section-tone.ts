/**
 * Färgton per avdelning (#1164): avdelningarna på en sida flöt ihop — vita
 * kort med likadana rubrikrader. Rubrikraden får en svag bakgrund i
 * avdelningens färg och en färgad kant till vänster, så man ser direkt var
 * kontakter slutar och fakturering börjar. Bara färger som har mörka
 * varianter i globals.css (mörkt läge).
 */

export type SectionTone = "red" | "amber" | "blue" | "purple" | "green" | "indigo" | "orange" | "gray";

/**
 * Ett steg starkare än första versionen (#1636: rutorna smälte ihop i ljust
 * läge). `section-tone-*` bär mörkt läge: `.dark`-reglerna i globals.css ger
 * rubrikraden samma färger som förut, utan att röra andra element som har
 * `bg-*-200`/`border-*-300` (t.ex. `.dark .bg-gray-200`).
 */
const TONES: Readonly<Record<SectionTone, string>> = {
  red: "section-tone-red bg-red-200 border-red-300 border-l-red-600",
  amber: "section-tone-amber bg-amber-200 border-amber-300 border-l-amber-600",
  blue: "section-tone-blue bg-blue-200 border-blue-300 border-l-blue-600",
  purple: "section-tone-purple bg-purple-200 border-purple-300 border-l-purple-600",
  green: "section-tone-green bg-green-200 border-green-300 border-l-green-600",
  indigo: "section-tone-indigo bg-indigo-200 border-indigo-300 border-l-indigo-600",
  orange: "section-tone-orange bg-orange-200 border-orange-300 border-l-orange-600",
  gray: "section-tone-gray bg-gray-200 border-gray-300 border-l-gray-500",
};

/**
 * Ytan för en avdelning som är hela rutans innehåll (#1844, `PanelDef.fill`):
 * vit, utan egen ram och rundning, så att avdelningen går ut till rutans kant.
 */
export const SECTION_FILL_CLASS = "bg-white";

/**
 * Ytan för en av flera avdelningar i samma ruta (#1846): vit med tunn ram och
 * 8 px luft inuti. Rutan ger 8 px runt och mellan avdelningarna.
 */
export const SECTION_CARD_CLASS = "bg-white rounded-lg border border-gray-200 p-2";

/** Klasser för en avdelnings rubrikrad. `layout` = flex-uppställningen (default: titel vänster, åtgärder höger). */
export function sectionHeaderClass(tone: SectionTone, layout = "flex items-center justify-between"): string {
  return `px-3 py-2 border-b border-l-4 ${TONES[tone]} ${layout}`;
}
