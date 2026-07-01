/**
 * Rättshjälps-billing (#349). Ren beräkningslogik, inga DB-anrop — allt i öre.
 *
 * Ett rättshjälpsärende går via domstol och faktureras med en kostnadsräkning
 * till domstolen. Klienten betalar själv två saker:
 *   1. En **rådgivningstimme** (1 h) enligt rättshjälpstaxan — en separat
 *      klientfaktura. Den syns som en TEXTRAD på domstolens kostnadsräkning
 *      (transparens, inget belopp domstolen ska betala).
 *   2. **Rättshjälpsavgiften** — en procent-andel av upparbetad tid, faktureras
 *      som acconto till klienten (täcks av `clientShareBips` på BillingRun).
 *
 * Rådgivningsersättningen enligt rättshjälpslagen följer **timkostnadsnormen**
 * (samma norm som brottmål/offentligt biträde), därför återanvänds
 * {@link computeTimkostnadsnorm} här i stället för en egen hårdkodad sats.
 */

import { computeTimkostnadsnorm } from "@/lib/shared/brottmalstaxa";

/** Rådgivning enligt rättshjälpslagen = 1 timme. */
export const RADGIVNING_MINUTES = 60;

/**
 * Tröskel (öre) för klientens självrisk innan ett självrisk-aconto skickas (#854):
 * när den ackumulerade självrisken nått hit flaggar panelen att det är dags att
 * skicka ett aconto till klienten. Default 1500 kr.
 * ponytail: konstant nu; flytta till byrå-inställning om byråer vill olika tröskel.
 */
export const SJALVRISK_ACCONTO_THRESHOLD_ORE = 150_000;

export interface Radgivningsavgift {
  /** Antal minuter (alltid 60 — en rådgivningstimme). */
  minutes: number;
  /** Tillämpad timkostnadsnorm (öre/h). */
  rateOrePerH: number;
  /** Avgiften exkl moms (öre) — en timme × timkostnadsnormen. */
  beloppExclVatOre: number;
}

/**
 * Rådgivningsavgiften för den klient-betalda rådgivningstimmen: 1 h enligt
 * timkostnadsnormen (F-skatt-justerad om advokaten saknar F-skatt).
 */
export function computeRadgivningsavgift(opts: { hasFTax?: boolean } = {}): Radgivningsavgift {
  const norm = computeTimkostnadsnorm({ arbetsMinutes: RADGIVNING_MINUTES, ...opts });
  return { minutes: RADGIVNING_MINUTES, rateOrePerH: norm.rateOrePerH, beloppExclVatOre: norm.arbete };
}

/**
 * Textraden om den klient-betalda rådgivningstimmen som ska synas på domstolens
 * kostnadsräkning (#383): transparens, inget belopp domstolen ska betala.
 */
export function radgivningTextRad(): string {
  return "Rådgivningstimme (1 tim) fakturerad och betald av klienten separat enligt " +
    "rättshjälpstaxan — ingår ej i denna kostnadsräkning.";
}

export interface MatterSettlementInput {
  /** Upparbetat arvode (debiterbar tid), öre. */
  arvodeOre: number;
  /** Debiterbara utlägg, öre. */
  utlaggOre: number;
  /** Domstolens prutning (≤ 0 — minskar bruttot). Default 0. */
  prutningOre?: number;
  /** Klient-betald rådgivningstimme (separat klientfaktura), öre. Default 0. */
  radgivningOre?: number;
  /** Summa acconto-fakturor klienten redan betalat, öre. Default 0. */
  accontoPaidOre?: number;
  /** Summa registrerade betalningar mot slutfakturan, öre. Default 0. */
  paymentsOre?: number;
}

export interface MatterSettlement {
  arvodeOre: number;
  utlaggOre: number;
  prutningOre: number;
  /** Brutto efter prutning: arvode + utlägg + prutning (prutning negativ). */
  bruttoOre: number;
  radgivningOre: number;
  accontoPaidOre: number;
  /** Vad slutfakturan till klienten kräver: brutto − redan betalda acconton. */
  slutfakturaOre: number;
  paymentsOre: number;
  /** Kvar att betala på slutfakturan: slutfaktura − betalningar. */
  outstandingOre: number;
}

/**
 * Bygger den fullständiga ärende-sammanställningen för slutfakturan (#349 C):
 * upparbetat arvode, utlägg, ev. prutning, betalda acconton, rådgivningstimmen
 * och utestående saldo. Generellt användbar även utanför rättshjälp.
 */
export function computeMatterSettlement(input: MatterSettlementInput): MatterSettlement {
  const prutningOre = input.prutningOre ?? 0;
  const radgivningOre = input.radgivningOre ?? 0;
  const accontoPaidOre = input.accontoPaidOre ?? 0;
  const paymentsOre = input.paymentsOre ?? 0;

  const bruttoOre = input.arvodeOre + input.utlaggOre + prutningOre;
  const slutfakturaOre = bruttoOre - accontoPaidOre;
  const outstandingOre = slutfakturaOre - paymentsOre;

  return {
    arvodeOre: input.arvodeOre,
    utlaggOre: input.utlaggOre,
    prutningOre,
    bruttoOre,
    radgivningOre,
    accontoPaidOre,
    slutfakturaOre,
    paymentsOre,
    outstandingOre,
  };
}
