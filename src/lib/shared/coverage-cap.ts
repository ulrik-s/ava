/**
 * Täcknings-tak för rättshjälp/rättsskydd (#793) — ren logik, ingen I/O.
 *
 * Myndigheten/försäkringen betalar bara upp till ett TAK:
 *   - Rättsskydd: ett BELOPP (försäkringens maxbelopp, ur beslutet).
 *   - Rättshjälp: 100 TIMMAR (rättshjälpslagen; kan utökas → konfigurerbart).
 *
 * När upparbetat arbete når ≥ 90 % av taket ska ärendet varnas (begär utökat
 * rättsskydd / utökad rättshjälp).
 */

import type { PaymentMethod } from "./schemas/enums";

/** Tröskel (andel av taket) där ärendet ska varnas. */
export const COVERAGE_WARN_RATIO = 0.9;

/** Rättshjälpens lagstadgade timtak (default tills utökat). */
export const DEFAULT_RATTSHJALP_TIMMAR = 100;

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
  /** ratio ≥ 90 % — visa varning. */
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
    return statusOf("amount", input.billableValueOre, capOre);
  }
  if (input.method === "RATTSHJALP") {
    const capMinutes = (input.rattshjalpMaxTimmar ?? DEFAULT_RATTSHJALP_TIMMAR) * 60;
    return statusOf("hours", input.billableMinutes, capMinutes);
  }
  return null;
}

function statusOf(kind: "amount" | "hours", usedOre: number, capOre: number): CoverageStatus {
  const ratio = capOre > 0 ? usedOre / capOre : 0;
  return { kind, usedOre, capOre, ratio, nearCap: ratio >= COVERAGE_WARN_RATIO, overCap: ratio >= 1 };
}
