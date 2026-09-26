/**
 * `kr-format` — svensk tal-/beloppsformatering för kostnadsräkningen (#1218).
 *
 * Samlad här så att sammanställningen, arbetsredogörelsen och de äldre
 * vy-fälten (`arvodeExclFormatted` m.fl.) formaterar på exakt samma sätt.
 * Alla belopp in i öre (heltal) — formateringen avrundar aldrig beloppet, den
 * visar det som det är räknat.
 */

const TWO_DECIMALS = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UP_TO_TWO_DECIMALS = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Öre → `"50 975,10 kr"` (alltid två decimaler). */
export function formatOreAsKr(ore: number): string {
  return `${TWO_DECIMALS.format(ore / 100)} kr`;
}

/** Minuter → decimaltimmar med två decimaler, `"31,35"` (utan enhet). */
export function formatHours(minutes: number): string {
  return TWO_DECIMALS.format(minutes / 60);
}

/**
 * Öre → belopp utan enhet, decimaler bara när de behövs: `"152"`, `"9,50"`.
 * Arbetsredogörelsens utläggskolumner (antal · á-pris · belopp).
 */
export function formatPlainKr(ore: number): string {
  return ore % 100 === 0 ? UP_TO_TWO_DECIMALS.format(ore / 100) : TWO_DECIMALS.format(ore / 100);
}

/** Á-pris i sammanställningen: `"1 626 kr"`, eller `"1 234,56 kr"` när öre finns. */
export function formatRateKr(ore: number): string {
  return `${formatPlainKr(ore)} kr`;
}

/** Ett antal (t.ex. 16 mil) — heltal utan decimaler, annars upp till två. */
export function formatQuantity(n: number): string {
  return UP_TO_TWO_DECIMALS.format(n);
}

/** Minuter → `"1 tim 25 min"` / `"50 min"` / `"3 tim"` (`"0 min"` för 0). */
export function formatMinutes(m: number): string {
  if (m <= 0) return "0 min";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h} tim` : `${h} tim ${rest} min`;
}
