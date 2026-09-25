/**
 * Färgton per avdelning (#1164): avdelningarna på en sida flöt ihop — vita
 * kort med likadana rubrikrader. Rubrikraden får en svag bakgrund i
 * avdelningens färg och en färgad kant till vänster, så man ser direkt var
 * kontakter slutar och fakturering börjar. Bara färger som har mörka
 * varianter i globals.css (mörkt läge).
 */

export type SectionTone = "red" | "amber" | "blue" | "purple" | "green" | "indigo" | "orange" | "gray";

const TONES: Readonly<Record<SectionTone, string>> = {
  red: "bg-red-100 border-red-200 border-l-red-500",
  amber: "bg-amber-100 border-amber-200 border-l-amber-500",
  blue: "bg-blue-100 border-blue-200 border-l-blue-500",
  purple: "bg-purple-100 border-purple-200 border-l-purple-500",
  green: "bg-green-100 border-green-200 border-l-green-500",
  indigo: "bg-indigo-100 border-indigo-200 border-l-indigo-500",
  orange: "bg-orange-100 border-orange-200 border-l-orange-500",
  gray: "bg-gray-100 border-gray-200 border-l-gray-400",
};

/** Klasser för en avdelnings rubrikrad. `layout` = flex-uppställningen (default: titel vänster, åtgärder höger). */
export function sectionHeaderClass(tone: SectionTone, layout = "flex items-center justify-between"): string {
  return `px-6 py-4 border-b border-l-4 rounded-t-lg ${TONES[tone]} ${layout}`;
}
