/**
 * Öre → "1 234,50 kr" för text som byggs utanför React (anteckningar,
 * bevakningsrubriker, #1221). Samma format som UI:ts `formatCurrency`.
 */
const KR_FMT = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" });

export function formatKr(ore: number): string {
  return KR_FMT.format(ore / 100);
}
