/**
 * `kr-format` — svensk tal-/beloppsformatering: belopp i kronor i hela appen
 * (#1946), kostnadsräkningen (#1218) och tid i decimaltimmar i appens vyer
 * (#1542), fakturor och kostnadsräkningar (#1543).
 *
 * `formatKr` är appens ENDA formaterare för belopp i kronor: UI:t, fakturan,
 * kostnadsräkningens dokument, mallarnas `{{formatAmount}}` och texterna som
 * byggs utanför React (anteckningar, bevakningsrubriker, #1221). Alla belopp
 * in i öre (heltal) — formateringen avrundar aldrig beloppet, den visar det
 * som det är räknat. Hårt mellanslag (U+00A0) före "kr", så att enheten
 * aldrig hamnar ensam på nästa rad.
 */

const KR_FMT = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" });
const TWO_DECIMALS = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UP_TO_TWO_DECIMALS = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** Hårt mellanslag + enheten, som `KR_FMT` skriver den. */
const NBSP_KR = "\u00A0kr";

/** Öre → `"1 234,50 kr"` (alltid två decimaler, U+00A0 som tusentalsavgränsare och före "kr"). */
export function formatKr(ore: number): string {
  return KR_FMT.format(ore / 100);
}

/**
 * Öre → belopp utan enhet, decimaler bara när de behövs: `"152"`, `"9,50"`.
 * Arbetsredogörelsens utläggskolumner (antal · á-pris · belopp).
 */
export function formatPlainKr(ore: number): string {
  return ore % 100 === 0 ? UP_TO_TWO_DECIMALS.format(ore / 100) : TWO_DECIMALS.format(ore / 100);
}

/**
 * Á-pris: `"1 626 kr"`, eller `"975,50 kr"` när öre finns — decimaler bara
 * när de behövs, hårt mellanslag före "kr" som i `formatKr`.
 */
export function formatRateKr(ore: number): string {
  return `${formatPlainKr(ore)}${NBSP_KR}`;
}

/** Ett antal (t.ex. 16 mil) — heltal utan decimaler, annars upp till två. */
export function formatQuantity(n: number): string {
  return UP_TO_TWO_DECIMALS.format(n);
}

/**
 * Minuter → decimaltimmar med svenskt decimalkomma, högst två decimaler och
 * inga onödiga (#1542): 90 → `"1,5"`, 15 → `"0,25"`, 120 → `"2"`. Äldre tid
 * utanför 6-minutersrutnätet visas avrundad till två decimaler (37 → `"0,62"`);
 * bara visningen avrundas, aldrig de lagrade minuterna. Utan enhet.
 */
export function formatDecimalHours(minutes: number): string {
  return UP_TO_TWO_DECIMALS.format(minutes / 60);
}

/** Som `formatDecimalHours` men med enheten: `"1,5 h"` — där siffran står ensam. */
export function formatDecimalHoursWithUnit(minutes: number): string {
  return `${formatDecimalHours(minutes)} h`;
}
