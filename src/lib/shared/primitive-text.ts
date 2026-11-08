/**
 * Text för ett värde av okänd typ — utan "[object Object]" (#1469,
 * `no-base-to-string`). Primitiva värden (sträng, tal, bigint, boolean) ges
 * som text; allt annat (objekt, JSX, Date, funktioner, symboler,
 * null/undefined) ger "". Den som vill ha JSON för objekt säger det själv
 * (se `templateText` i server/rules/template.ts).
 */
export function primitiveText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  return "";
}
