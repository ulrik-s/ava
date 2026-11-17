/**
 * Färgton per avdelning (#1164): avdelningarna på en sida flöt ihop — vita
 * kort med likadana rubrikrader. Rubrikraden får en svag bakgrund i
 * avdelningens färg och en färgad kant till vänster, så man ser direkt var
 * kontakter slutar och fakturering börjar. Bara färger som har mörka
 * varianter i globals.css (mörkt läge).
 *
 * #1636: ett steg starkare i ljust läge (200/300/600, grått 200/300/500).
 * Markörklassen `section-header` ger mörkt läge samma värden som förut:
 * globals.css delar deklarationen med bg-X-100/border-X-200 för rubrikraden,
 * utan att röra andra element som använder bg-X-200 eller border-X-300.
 */

export type SectionTone = "red" | "amber" | "blue" | "purple" | "green" | "indigo" | "orange" | "gray";

const TONES: Readonly<Record<SectionTone, string>> = {
  red: "bg-red-200 border-red-300 border-l-red-600",
  amber: "bg-amber-200 border-amber-300 border-l-amber-600",
  blue: "bg-blue-200 border-blue-300 border-l-blue-600",
  purple: "bg-purple-200 border-purple-300 border-l-purple-600",
  green: "bg-green-200 border-green-300 border-l-green-600",
  indigo: "bg-indigo-200 border-indigo-300 border-l-indigo-600",
  orange: "bg-orange-200 border-orange-300 border-l-orange-600",
  gray: "bg-gray-200 border-gray-300 border-l-gray-500",
};

/** Klasser för en avdelnings rubrikrad. `layout` = flex-uppställningen (default: titel vänster, åtgärder höger). */
export function sectionHeaderClass(tone: SectionTone, layout = "flex items-center justify-between"): string {
  return `section-header px-6 py-4 border-b border-l-4 rounded-t-lg ${TONES[tone]} ${layout}`;
}
