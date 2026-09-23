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

import type { VatBreakdownLine } from "./accounting/semantic-voucher";
import {
  arvodeLine, expenseBreakdownLines, grossOreOf, netOreOf, timeEntryValueOre,
  type UnfrozenWork,
} from "./billing-work-value";
import { coverageEntryRateOre } from "./brottmalstaxa";
import { arvodeInclVatOre } from "./invoice-calc";
import { omitUndefined } from "./omit-undefined";
import type { PaymentMethod, TimeEntryKind } from "./schemas/enums";

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

/**
 * Rättsskydd: VARFÖR klientens del blev som den blev (#935). Klientens andel är
 * inte bara "självrisken" — den är summan av fyra poster. Delarna returneras här
 * så klientfakturan kan itemisera dem i stället för att visa ett lumpet belopp.
 *
 * Invariant: `uncoveredOre + sjalvriskOre + prutningOre + overCapOre === clientOre`.
 */
export interface RattsskyddClientParts {
  /** Otäckt arbete: före tvistdatum + retroaktivt utöver 6 h — klienten betalar 100 %. */
  uncoveredOre: number;
  /** Självrisk på den TÄCKTA delen (andel%, golv-justerad). */
  sjalvriskOre: number;
  /** Försäkringsbolagets prutning — klienten bär den (byrån blir hel). */
  prutningOre: number;
  /** Belopp över försäkringens maxbelopp — faller på klienten. */
  overCapOre: number;
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
  /** Rättsskydd: nedbrytning av `clientOre`. Utelämnad för andra betalningssätt. */
  clientParts?: RattsskyddClientParts;
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
  const clientOre = total - payerOre;
  // Delarna av klientens andel (#935). `prutning`/`sjalvrisk` klampas till det som
  // faktiskt bars av den täckta delen (insurerRaw kan ha nollats), så summan alltid
  // stämmer med clientOre — resten hamnar i `uncoveredOre`.
  const carried = Math.min(covered, sjalvrisk + prutning);
  const sjalvriskPart = Math.min(carried, sjalvrisk);
  return {
    clientOre, payerOre, firmLossOre: 0, effectiveTotalOre: total,
    clientParts: {
      uncoveredOre: clientOre - carried - overCap,
      sjalvriskOre: sjalvriskPart,
      prutningOre: carried - sjalvriskPart,
      overCapOre: overCap,
    },
  };
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


/** Matter-fält som styr rättsskyddets tidsuppdelning + tak. */
export interface RattsskyddMatter {
  paymentMethod: PaymentMethod;
  tvistUppkomDatum?: Date | string | null | undefined;
  rattsskyddBeslutDatum?: Date | string | null | undefined;
  rattsskyddMaxOre?: number | null | undefined;
  rattsskyddSjalvriskMinOre?: number | null | undefined;
}

/**
 * Rättsskydds-tillägg till computeCoverageSplit (#810): tidsuppdelar arbetet
 * (täckt del efter tvist/retro-tak) → `coveredOre`, samt försäkringens tak →
 * `capOre`. Tom för andra betalningssätt (då gäller standard-splitten).
 */
/**
 * Värdet (netto) av den TÄCKTA delen (#950). Minuterna kommer ur den kronologiska
 * partitioneringen, men värdet måste räknas på posternas KATEGORINORMER — samma
 * valuta som `settlementArvodeNet` — annars jämförs äpplen med päron. Fördelar de
 * täckta minuterna över posterna i ordning (äldsta först).
 */
export function coveredValueOre(
  entries: ReadonlyArray<{ minutes: number; billable: boolean; kind?: TimeEntryKind | null | undefined }>,
  coveredMinutes: number, settleDate: Date | string,
): number {
  let left = coveredMinutes;
  let value = 0;
  for (const t of entries.filter((e) => e.billable)) {
    if (left <= 0) break;
    const take = Math.min(left, t.minutes);
    value += timeEntryValueOre(take, coverageEntryRateOre(t.kind, settleDate));
    left -= take;
  }
  return value;
}

export function rattsskyddCoverage(
  matter: RattsskyddMatter,
  entries: ReadonlyArray<{ date: Date | string; minutes: number; billable: boolean; kind?: TimeEntryKind | null | undefined }>,
  settleDate: Date | string,
  // `minSjalvriskOre` returneras också (självrisk-golvet, #899) — utan den i typen
  // trodde TS att den aldrig skickas till computeCoverageSplit, trots att den gör det.
): { coveredOre?: number; capOre?: number; minSjalvriskOre?: number } {
  if (matter.paymentMethod !== "RATTSSKYDD") return {};
  const p = partitionRattsskyddMinutes(entries, matter.tvistUppkomDatum ?? null, matter.rattsskyddBeslutDatum ?? null);
  return omitUndefined({
    // MÅSTE värderas på samma sätt som arvodesbasen (#950), annars jämförs täckt
    // arbete mot en bas i en annan taxa och otäckt/självrisk blir fel.
    coveredOre: coveredValueOre(entries, p.coveredMinutes, settleDate),
    capOre: matter.rattsskyddMaxOre ?? undefined,
    minSjalvriskOre: matter.rattsskyddSjalvriskMinOre ?? undefined,
  });
}

/** Dela utläggs-raderna mellan klient och betalare med SAMMA andel som arvodet
 *  (#878): klientens andel = clientOre/effectiveTotal. Betalaren får resten (så
 *  öre-avrundning aldrig tappas). Per momssats-rad delas netto + moms var för sig. */
export function apportionExpenseLines(lines: VatBreakdownLine[], split: CoverageSplit): { clientLines: VatBreakdownLine[]; payerLines: VatBreakdownLine[] } {
  const denom = split.effectiveTotalOre;
  const clientLines: VatBreakdownLine[] = [];
  const payerLines: VatBreakdownLine[] = [];
  for (const l of lines) {
    const clientNet = denom > 0 ? Math.round((l.netOre * split.clientOre) / denom) : 0;
    const clientVat = denom > 0 ? Math.round((l.vatOre * split.clientOre) / denom) : 0;
    if (clientNet + clientVat > 0) clientLines.push({ ...l, netOre: clientNet, vatOre: clientVat });
    const payerNet = l.netOre - clientNet;
    const payerVat = l.vatOre - clientVat;
    if (payerNet + payerVat > 0) payerLines.push({ ...l, netOre: payerNet, vatOre: payerVat });
  }
  return { clientLines, payerLines };
}

/** Faktura-rader (moms-breakdown) för klient- resp. betalar-fakturan ur en
 *  prutnings-/rättshjälpsavgifts-uppdelning (#801). Både arvode OCH utlägg delas
 *  per samma klient/betalar-andel (#878). */
export function coverageInvoiceLines(split: CoverageSplit, expenseLines: VatBreakdownLine[]): {
  clientLines: VatBreakdownLine[]; payerLines: VatBreakdownLine[];
  clientExpenseLines: VatBreakdownLine[]; payerExpenseLines: VatBreakdownLine[];
} {
  const clientArvode = arvodeLine(split.clientOre);
  const payerArvode = arvodeLine(split.payerOre);
  // Raderna bär redan de DEBITERADE satserna (#975) — 25 % på kostnadselement,
  // 0 % på äkta utlägg — så andelarna ärver dem. Förr räknades betalarens andel
  // om till 25 % bara när betalaren var domstol (#945); regeln följer biträdets
  // omsättning, inte mottagaren, så det specialfallet är borta.
  const exp = apportionExpenseLines(expenseLines, split);
  return {
    clientLines: [...(clientArvode ? [clientArvode] : []), ...exp.clientLines],
    payerLines: [...(payerArvode ? [payerArvode] : []), ...exp.payerLines],
    clientExpenseLines: exp.clientLines, payerExpenseLines: exp.payerLines,
  };
}

/**
 * Skala moms-rader proportionellt (#943). Domstolens nedsättning träffar hela
 * anspråket — arvode OCH utlägg — så varje rad skalas med samma faktor och
 * behåller sin momssats. Utan detta bokas nedsättningen som om utläggen vore
 * oberörda, och per-sats-bokföringen (#790) blir fel.
 */
export function scaleVatLines(lines: VatBreakdownLine[], factor: number): VatBreakdownLine[] {
  if (factor >= 1) return lines;
  return lines.map((l) => ({ ...l, netOre: Math.round(l.netOre * factor), vatOre: Math.round(l.vatOre * factor) }));
}

/**
 * Domstolens nedsättning som andel av det YRKADE beloppet (#943). Kostnads-
 * räkningen yrkar arvode + utlägg INKL moms och beslutet avser den summan, så
 * jämförelsen måste ske brutto mot brutto. Tidigare mättes det beviljade
 * bruttobeloppet mot arvodet NETTO, vilket fick `Math.min` att klampa bort hela
 * nedsättningen. Utan beslut (null) → faktor 1, dvs ingen nedsättning.
 */
export function awardFactor(awardedOre: number | null, claimGrossOre: number): number {
  if (awardedOre == null || claimGrossOre <= 0) return 1;
  return Math.min(1, Math.max(0, awardedOre / claimGrossOre));
}

/**
 * Domstolens nedsättning applicerad på HELA anspråket (#943): kostnadsräkningen
 * yrkar arvode + utlägg inkl moms, och beslutet avser den summan. Skala därför
 * både arvodet och varje utläggsrad med samma faktor, och returnera arvodesdelen
 * i NETTO så `computeCoverageSplit` (som räknar på nettoarvode) får rätt bas.
 * Rättsskydd rör inte den här vägen — där är bolagets prutning en egen händelse
 * som klienten bär (`recordInsurerPruning`).
 */
export function resolveAward(method: PaymentMethod, totalArvodeNet: number, work: UnfrozenWork, awardedOre: number | null): {
  awardedArvodeNetOre: number | null; expenseLines: VatBreakdownLine[]; expenseLossNetOre: number; expensesBaseNetOre: number;
} {
  const rawExpenseLines = expenseBreakdownLines(work);
  const expensesBaseNetOre = netOreOf(rawExpenseLines);
  if (method !== "RATTSHJALP") {
    return { awardedArvodeNetOre: awardedOre, expenseLines: rawExpenseLines, expenseLossNetOre: 0, expensesBaseNetOre };
  }
  const claimGrossOre = arvodeInclVatOre(totalArvodeNet) + grossOreOf(rawExpenseLines);
  const factor = awardFactor(awardedOre, claimGrossOre);
  const expenseLines = scaleVatLines(rawExpenseLines, factor);
  return {
    awardedArvodeNetOre: Math.round(totalArvodeNet * factor),
    expenseLines, expensesBaseNetOre,
    // Byrån bär nedsättningen på utläggen också — arvodesdelen bärs via split.firmLossOre.
    expenseLossNetOre: netOreOf(rawExpenseLines) - netOreOf(expenseLines),
  };
}
