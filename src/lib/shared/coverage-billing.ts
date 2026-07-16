/**
 * Prutnings-/självrisk-fördelning för rättshjälp & rättsskydd (#800) — ren
 * logik, inga I/O. Alla belopp i öre och i NETTO (exkl moms) — momsen läggs på
 * när fakturorna skapas (#782).
 *
 * Två regimer beroende på vem som prutar:
 *
 *  RÄTTSSKYDD (försäkring prutar): klienten tar mellanskillnaden, byrån blir hel.
 *    självrisk S = andel% × total (omvärderat på aktuellt timarvode)
 *    försäkringen betalar = total − S − prutning   (prutning ur bolagets brev)
 *    klient = S + prutning = total − det försäkringen betalar
 *    byrå-förlust = 0
 *
 *  RÄTTSHJÄLP (domstol/myndighet prutar): byrån TAPPAR mellanskillnaden (får ej
 *  ta ut den av klienten); klientens självrisk räknas om på det NYA beloppet.
 *    reducerat = domens beviljade belopp (≤ total)
 *    klient = andel% × reducerat
 *    staten betalar = reducerat − klient
 *    byrå-förlust = total − reducerat
 *
 * `total` ska vara arvodet omvärderat på det DÅ GÄLLANDE timarvodet (#800):
 * rättshjälp → timkostnadsnormen; rättsskydd → juristens aktuella timtaxa.
 */

import type { PaymentMethod } from "./schemas/enums";

export interface CoverageSplitInput {
  method: PaymentMethod;
  /** Arvode (netto) omvärderat på aktuellt timarvode. */
  totalOre: number;
  /** Klientens självrisk-/avgifts-andel i bips (2500 = 25 %). */
  clientShareBips: number;
  /** Rättshjälp: domens beviljade belopp (öre). Saknas → ingen reduktion (= total). */
  awardedOre?: number | null;
  /** Rättsskydd: försäkringsbolagets prutning (öre, ur brevet). Saknas → 0. */
  insurerPrutningOre?: number | null;
  /**
   * Rättsskydd: den TÄCKTA delen (öre) efter tidsuppdelning (#810) — arbete från
   * tvistdatum, retroaktivt högst 6 h. Saknas → hela totalen är täckt (bakåt-
   * kompatibelt). Den otäckta delen (total − covered) betalar klienten 100 %.
   */
  coveredOre?: number | null;
  /** Rättsskydd: försäkringens maxbelopp (öre, ur beslutet). Försäkringen betalar
   *  högst detta; överskott → klienten. Saknas → inget tak. */
  capOre?: number | null;
  /** Rättsskydd: lägsta självrisk (öre) — "dock lägst 1 800 kr" (#899). Klientens
   *  självrisk = max(detta, andel% × täckt). Saknas → 0. */
  minSjalvriskOre?: number | null;
}

export interface CoverageSplit {
  /** Vad klienten ska betala (netto, öre). */
  clientOre: number;
  /** Vad betalaren (försäkring/stat) betalar (netto, öre). */
  payerOre: number;
  /** Byråns förlust (netto, öre) — endast vid rättshjälps-prutning. */
  firmLossOre: number;
  /** Den faktiska total som fördelas (efter ev. rättshjälps-reduktion). */
  effectiveTotalOre: number;
}

function shareOf(ore: number, bips: number): number {
  return Math.round((ore * bips) / 10000);
}

export function computeCoverageSplit(input: CoverageSplitInput): CoverageSplit {
  const total = Math.max(0, input.totalOre);
  if (input.method === "RATTSHJALP") {
    const reduced = clampReduction(input.awardedOre, total);
    const clientOre = shareOf(reduced, input.clientShareBips);
    return { clientOre, payerOre: reduced - clientOre, firmLossOre: total - reduced, effectiveTotalOre: reduced };
  }
  if (input.method === "RATTSSKYDD") {
    return rattsskyddSplit(total, input);
  }
  // Andra betalningssätt: ingen självrisks-/prutnings-uppdelning.
  return { clientOre: total, payerOre: 0, firmLossOre: 0, effectiveTotalOre: total };
}

/**
 * Rättsskydds-uppdelning: klienten betalar 100 % av den OTÄCKTA delen (arbete
 * före tvist + retroaktivt utöver 6 h), självrisksandelen av den täckta delen,
 * samt bolagets prutning. Försäkringen betalar resten av den täckta delen, dock
 * högst takbeloppet — överskott över taket faller på klienten. Byrån blir hel.
 */
function rattsskyddSplit(total: number, input: CoverageSplitInput): CoverageSplit {
  const covered = Math.max(0, Math.min(input.coveredOre ?? total, total));
  // Självrisk = andel% × täckt, dock LÄGST beslutets golv-belopp (#899), men aldrig
  // mer än den täckta delen (annars skulle försäkringen betala negativt).
  const sjalvrisk = Math.min(covered, Math.max(input.minSjalvriskOre ?? 0, shareOf(covered, input.clientShareBips)));
  const prutning = Math.max(0, input.insurerPrutningOre ?? 0);
  const insurerRaw = Math.max(0, covered - sjalvrisk - prutning);
  const overCap = input.capOre != null ? Math.max(0, insurerRaw - input.capOre) : 0;
  const payerOre = insurerRaw - overCap;
  return { clientOre: total - payerOre, payerOre, firmLossOre: 0, effectiveTotalOre: total };
}

/** Rättsskyddets retroaktiva tak: arbete före det positiva beslutet får ingå
 *  med HÖGST 6 timmar (hård gräns, #810). */
export const RATTSSKYDD_RETRO_MAX_MINUTES = 360;

export interface RattsskyddPartition {
  /** Täckt: retroaktivt (≤ 6 h) + arbete efter beslutet. */
  coveredMinutes: number;
  /** Före tvistdatum → klienten betalar 100 %. */
  preDisputeMinutes: number;
  /** Retroaktivt utöver 6 h-taket → klienten betalar 100 %. */
  retroExcessMinutes: number;
}

/**
 * Delar upp debiterbara minuter efter datum (#810): arbete före `tvistUppkomDatum`
 * är aldrig täckt; arbete mellan tvistdatum och `rattsskyddBeslutDatum` är
 * retroaktivt och täcks med högst `retroMaxMinutes`; arbete från beslutet täcks
 * fullt. Saknas tvistdatum → inget är "före tvist"; saknas beslutsdatum → inget
 * retroaktivt tak (allt från tvistdatum täcks).
 */
export function partitionRattsskyddMinutes(
  entries: ReadonlyArray<{ date: Date | string; minutes: number; billable: boolean }>,
  tvistUppkomDatum: Date | string | null | undefined,
  rattsskyddBeslutDatum: Date | string | null | undefined,
  retroMaxMinutes: number = RATTSSKYDD_RETRO_MAX_MINUTES,
): RattsskyddPartition {
  const tvist = asTime(tvistUppkomDatum);
  const beslut = asTime(rattsskyddBeslutDatum);
  let preDispute = 0, retro = 0, post = 0;
  for (const e of entries) {
    if (!e.billable) continue;
    const bucket = classifyByDate(asTime(e.date), tvist, beslut);
    if (bucket === "pre") preDispute += e.minutes;
    else if (bucket === "retro") retro += e.minutes;
    else post += e.minutes;
  }
  const retroCovered = Math.min(retro, retroMaxMinutes);
  return { coveredMinutes: retroCovered + post, preDisputeMinutes: preDispute, retroExcessMinutes: retro - retroCovered };
}

/** Klassar en tidspost: före tvist / retroaktivt (tvist→beslut) / efter beslut. */
function classifyByDate(t: number | null, tvist: number | null, beslut: number | null): "pre" | "retro" | "post" {
  if (t == null) return "post";
  if (tvist != null && t < tvist) return "pre";
  if (beslut != null && t < beslut) return "retro";
  return "post";
}

/** Datum → epoch-ms; null/undefined → null (NaN-skydd för ogiltiga datum). */
function asTime(d: Date | string | null | undefined): number | null {
  if (d == null) return null;
  const ms = new Date(d).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Domens belopp klampat till [0, total]; saknas → ingen reduktion. */
function clampReduction(awardedOre: number | null | undefined, total: number): number {
  if (awardedOre == null) return total;
  return Math.max(0, Math.min(awardedOre, total));
}
