/**
 * Täcknings-tak för rättshjälp/rättsskydd (#793) — ren logik, ingen I/O.
 *
 * Myndigheten/försäkringen betalar bara upp till ett TAK:
 *   - Rättsskydd: ett BELOPP (försäkringens maxbelopp, ur beslutet).
 *   - Rättshjälp: 100 TIMMAR (rättshjälpslagen; kan utökas → konfigurerbart).
 *
 * När upparbetat arbete närmar sig taket ska ärendet varnas (begär utökat
 * rättsskydd / utökad rättshjälp):
 *   - Rättsskydd: vid ≥ 90 % av maxbeloppet.
 *   - Rättshjälp: vid ≥ 80 % av taket (80 tim med standardtaket), eller —
 *     när taket utökats över 100 tim — 10 tim före det nya taket (#1519).
 */

import type { PaymentMethod } from "./schemas/enums";

/** Tröskel (andel av taket) där ett rättsskyddsärende ska varnas. */
export const COVERAGE_WARN_RATIO = 0.9;

/** Rättshjälpens lagstadgade timtak (default tills utökat). */
export const DEFAULT_RATTSHJALP_TIMMAR = 100;

/** Rättshjälp med tak ≤ standardtaket: varna vid denna andel av taket. */
export const RATTSHJALP_WARN_RATIO = 0.8;

/** Rättshjälp med utökat tak (> standardtaket): varna så här många timmar före taket. */
export const RATTSHJALP_EXTENDED_MARGIN_TIMMAR = 10;

export interface CoverageCapInput {
  method?: PaymentMethod | null | undefined;
  /** Rättsskyddets maxbelopp i öre (null = ej satt → inget tak att mäta mot). */
  rattsskyddMaxOre?: number | null;
  /** Rättshjälpens timtak (null → 100 tim). */
  rattshjalpMaxTimmar?: number | null;
  /** Upparbetade debiterbara minuter. */
  billableMinutes: number;
  /** Upparbetat debiterbart arvode-värde i öre (exkl moms). */
  billableValueOre: number;
}

export interface CoverageStatus {
  kind: "amount" | "hours";
  /** Upparbetat (öre för amount, minuter för hours). */
  usedOre: number;
  /** Taket (öre för amount, minuter för hours). */
  capOre: number;
  /** used / cap (0..∞). */
  ratio: number;
  /** Varningsgränsen nådd (se `coverageStatus`) — visa varning. */
  nearCap: boolean;
  /** ratio ≥ 100 % — taket passerat. */
  overCap: boolean;
}

/**
 * Beräknar takstatus för ett ärende, eller `null` när inget tak gäller
 * (annat betalningssätt, eller rättsskydd utan satt maxbelopp).
 */
export function coverageStatus(input: CoverageCapInput): CoverageStatus | null {
  if (input.method === "RATTSSKYDD") {
    const capOre = input.rattsskyddMaxOre ?? 0;
    if (capOre <= 0) return null; // taket okänt tills beloppet matas in
    return statusOf("amount", input.billableValueOre, capOre, capOre * COVERAGE_WARN_RATIO);
  }
  if (input.method === "RATTSHJALP") {
    const capTimmar = input.rattshjalpMaxTimmar ?? DEFAULT_RATTSHJALP_TIMMAR;
    // Gränsen i hela minuter: 0,8 · 60 i flyttal blir annars t.ex. 576.0000000000001.
    const warnMinutes = Math.round(rattshjalpWarnTimmar(capTimmar) * 60);
    return statusOf("hours", input.billableMinutes, capTimmar * 60, warnMinutes);
  }
  return null;
}

/**
 * Rättshjälpens varningsgräns i timmar: 80 % av ett tak upp till standardtaket
 * (100 → 80 tim), men 10 tim före ett utökat tak (150 → 140 tim).
 */
function rattshjalpWarnTimmar(capTimmar: number): number {
  return capTimmar > DEFAULT_RATTSHJALP_TIMMAR
    ? capTimmar - RATTSHJALP_EXTENDED_MARGIN_TIMMAR
    : capTimmar * RATTSHJALP_WARN_RATIO;
}

function statusOf(kind: "amount" | "hours", usedOre: number, capOre: number, warnAt: number): CoverageStatus {
  const ratio = capOre > 0 ? usedOre / capOre : 0;
  return { kind, usedOre, capOre, ratio, nearCap: capOre > 0 && usedOre >= warnAt, overCap: ratio >= 1 };
}
