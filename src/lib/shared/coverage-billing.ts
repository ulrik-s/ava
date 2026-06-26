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
    const sjalvrisk = shareOf(total, input.clientShareBips);
    const prutning = Math.max(0, input.insurerPrutningOre ?? 0);
    const clientOre = Math.min(total, sjalvrisk + prutning);
    return { clientOre, payerOre: total - clientOre, firmLossOre: 0, effectiveTotalOre: total };
  }
  // Andra betalningssätt: ingen självrisks-/prutnings-uppdelning.
  return { clientOre: total, payerOre: 0, firmLossOre: 0, effectiveTotalOre: total };
}

/** Domens belopp klampat till [0, total]; saknas → ingen reduktion. */
function clampReduction(awardedOre: number | null | undefined, total: number): number {
  if (awardedOre == null) return total;
  return Math.max(0, Math.min(awardedOre, total));
}
