/**
 * Slutregleringens fördelning mellan klient och betalare i hela kronor (#1438).
 *
 * ## Modellen
 *
 * 1. TOTALEN räknas EN gång, brutto. Med domstolens beslut (rättshjälp) är den
 *    beslutet, taget som det är. Annars är den fakturans vanliga uträkning:
 *    nettot = summan av de avrundade raderna, momsen 25 % av det avrundat till
 *    hela kronor, totalen = netto + moms.
 * 2. KLIENTENS DEL = andelen av totalen INKL moms, avrundad till hela kronor —
 *    efter rättsskyddets golv och tak (lägsta självrisk, försäkringens maxbelopp,
 *    bolagets prutning, otäckt arbete), som förut.
 * 3. BETALARENS DEL = totalen − klientens del. Den räknas aldrig för sig.
 * 4. Varje faktura delar sitt brutto per momssats: nettot = bruttot / (1 + sats)
 *    i hela kronor, momsen = resten. Momsen på varje faktura är därmed rätt på
 *    under en krona, och klientens + betalarens brutto är EXAKT totalen. Deras
 *    netto och moms var för sig kan skilja en krona från det odelade — det är
 *    accepterat (Ulrik, #1438).
 *
 * Utläggen följer samma regel: de ingår i totalen och delas i samma steg, så
 * betalarens utläggsdel är alltid resten.
 */

import type { VatBreakdownLine } from "./accounting/semantic-voucher";
import { arvodeLine, expenseBreakdownLines, grossOreOf, netOreOf, vatOreOf, type UnfrozenWork } from "./billing-work-value";
import { computeCoverageSplit, type CoverageSplit, type RattsskyddClientParts } from "./coverage-billing";
import { arvodeInclVatOre } from "./invoice-calc";
import type { PaymentMethod } from "./schemas/enums";
import { kronorQuotient, splitGross } from "./whole-kronor";

const lineGross = (l: VatBreakdownLine): number => l.netOre + l.vatOre;

/**
 * Fördela `total` över vikterna i proportion, i hela kronor; den sista posten
 * tar resten så summan alltid är exakt `total` (även när `total` har ören).
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const parts = weights.map((w) => (sum > 0 ? kronorQuotient(total * w, sum) : 0));
  const last = parts.length - 1;
  if (last >= 0) parts[last] = total - parts.slice(0, last).reduce((s, p) => s + p, 0);
  return parts;
}

/**
 * Rader med givna brutton (`grosses[i]` hör till `lines[i]`). Per momssats delas
 * gruppens brutto i netto (hela kronor) och moms (resten); gruppens netto fördelas
 * över dess rader efter brutto. Så blir fakturans moms per sats rätt på under en
 * krona, och raderna summerar exakt till bruttona.
 */
export function linesWithGross(lines: readonly VatBreakdownLine[], grosses: readonly number[]): VatBreakdownLine[] {
  const gross = (i: number): number => grosses[i] ?? 0;
  const netByLine = new Map<number, number>();
  for (const rate of new Set(lines.map((l) => l.vatRate))) {
    const idx = lines.flatMap((l, i) => (l.vatRate === rate ? [i] : []));
    const groupNet = splitGross(idx.reduce((s, i) => s + gross(i), 0), rate).netOre;
    allocate(groupNet, idx.map(gross)).forEach((net, k) => netByLine.set(idx[k] ?? -1, net));
  }
  return lines
    .map((l, i) => ({ ...l, netOre: netByLine.get(i) ?? 0, vatOre: gross(i) - (netByLine.get(i) ?? 0) }))
    .filter((l) => lineGross(l) !== 0);
}

/** Det slutregleringen fördelar. Golv, tak och prutning anges NETTO, som i beslutet. */
export interface SettlementAllocationInput {
  method: PaymentMethod;
  /** Arvodet netto, summan av de avrundade raderna. */
  totalArvodeNet: number;
  work: UnfrozenWork;
  clientShareBips: number;
  /** Domstolens beviljade belopp (brutto) — rättshjälp; tas som det är. */
  awardedOre: number | null;
  /** Rättsskydd: bolagets prutning (netto). */
  insurerPrutningOre?: number | null | undefined;
  /** Rättsskydd: täckt del, tak och lägsta självrisk (netto, `rattsskyddCoverage`). */
  coverage: { coveredOre?: number; capOre?: number; minSjalvriskOre?: number };
}

/** Fördelningen med fakturornas rader. */
export interface SettlementAllocation {
  totalGrossOre: number;
  clientGrossOre: number;
  payerGrossOre: number;
  clientLines: VatBreakdownLine[];
  payerLines: VatBreakdownLine[];
  /** Domstolens nedsättning netto: arvodets och utläggens del (byrån bär den). */
  arvodeLossNetOre: number;
  expenseLossNetOre: number;
  /** Utlägg netto före nedsättningen. */
  expensesBaseNetOre: number;
  /** Netto-sammanfattning: klientens och betalarens netto (arvode + utlägg). */
  split: CoverageSplit;
}

/** Den odelade fakturans rader: arvodet + utläggen. */
function baseLinesOf(a: SettlementAllocationInput): VatBreakdownLine[] {
  const arvode = arvodeLine(a.totalArvodeNet);
  return [...(arvode ? [arvode] : []), ...expenseBreakdownLines(a.work)];
}

/** Rättshjälp med beslut: beslutet fördelas över raderna; annars de odelade raderna. */
function totalLinesOf(a: SettlementAllocationInput, base: VatBreakdownLine[]): VatBreakdownLine[] {
  if (a.method !== "RATTSHJALP" || a.awardedOre == null) return base;
  return linesWithGross(base, allocate(a.awardedOre, base.map(lineGross)));
}

/** Ett nettobelopp ur beslutet (golv, tak, prutning) som brutto, så det möter totalen. */
const grossOf = (net: number | null | undefined): number | null => (net == null ? null : arvodeInclVatOre(net));

/** Den täckta delen (netto av arvodet) som samma andel av totalen; null = allt täckt. */
function coveredGrossOf(a: SettlementAllocationInput, totalGross: number): number | null {
  const covered = a.coverage.coveredOre;
  if (covered == null || a.totalArvodeNet <= 0) return null;
  return kronorQuotient(covered * totalGross, a.totalArvodeNet);
}

/**
 * Klientens del av totalen (brutto). Rättshjälp: avgiftsandelen av totalen.
 * Rättsskydd: samma uppdelning som förut — otäckt, självrisk (lägst golvet),
 * bolagets prutning, över taket — räknad på totalen inkl moms.
 */
function clientSplit(a: SettlementAllocationInput, totalGross: number): CoverageSplit {
  if (a.method !== "RATTSSKYDD") return computeCoverageSplit({ method: a.method, totalOre: totalGross, clientShareBips: a.clientShareBips });
  return computeCoverageSplit({
    method: a.method, totalOre: totalGross, clientShareBips: a.clientShareBips,
    insurerPrutningOre: grossOf(a.insurerPrutningOre), coveredOre: coveredGrossOf(a, totalGross),
    capOre: grossOf(a.coverage.capOre), minSjalvriskOre: grossOf(a.coverage.minSjalvriskOre),
  });
}

/** Rättsskyddets klientposter som netto, avstämda så de summerar till klientens netto. */
function netParts(parts: RattsskyddClientParts | undefined, clientNetOre: number): RattsskyddClientParts | undefined {
  if (!parts) return undefined;
  const [uncoveredOre = 0, sjalvriskOre = 0, prutningOre = 0, overCapOre = 0] =
    allocate(clientNetOre, [parts.uncoveredOre, parts.sjalvriskOre, parts.prutningOre, parts.overCapOre]);
  return { uncoveredOre, sjalvriskOre, prutningOre, overCapOre };
}

const ofKind = (lines: readonly VatBreakdownLine[], kind: VatBreakdownLine["kind"]): VatBreakdownLine[] => lines.filter((l) => l.kind === kind);

/** Fördela slutregleringen enligt modellen ovan. Ren funktion. */
export function allocateSettlement(a: SettlementAllocationInput): SettlementAllocation {
  const base = baseLinesOf(a);
  const total = totalLinesOf(a, base);
  const totalGrossOre = grossOreOf(total);
  const gross = clientSplit(a, totalGrossOre);
  const clientParts = allocate(gross.clientOre, total.map(lineGross));
  const clientLines = linesWithGross(total, clientParts);
  const payerLines = linesWithGross(total, total.map((l, i) => lineGross(l) - (clientParts[i] ?? 0)));
  const arvodeLossNetOre = netOreOf(ofKind(base, "arvode")) - netOreOf(ofKind(total, "arvode"));
  const expensesBaseNetOre = netOreOf(ofKind(base, "utlagg"));
  const clientNetOre = netOreOf(clientLines);
  const parts = netParts(gross.clientParts, clientNetOre);
  return {
    totalGrossOre, clientGrossOre: gross.clientOre, payerGrossOre: totalGrossOre - gross.clientOre,
    clientLines, payerLines, arvodeLossNetOre, expensesBaseNetOre,
    expenseLossNetOre: expensesBaseNetOre - netOreOf(ofKind(total, "utlagg")),
    split: {
      clientOre: clientNetOre, payerOre: netOreOf(payerLines), firmLossOre: arvodeLossNetOre, effectiveTotalOre: netOreOf(total),
      ...(parts ? { clientParts: parts } : {}),
    },
  };
}

/** Delbeloppen slutregleringsvyn redovisar, ur fakturornas rader. */
export interface SettlementAmounts {
  sjalvriskNetOre: number; sjalvriskGrossOre: number;
  clientExpensesNetOre: number; clientExpensesVatOre: number; clientExpensesGrossOre: number;
  payerArvodeNetOre: number; payerArvodeVatOre: number;
  payerExpensesNetOre: number; payerExpensesVatOre: number; expensesGrossOre: number;
}

/** Klientens och betalarens arvodes- och utläggsdelar, exakt som fakturorna bär dem. */
export function settlementAmounts(s: Pick<SettlementAllocation, "clientLines" | "payerLines">): SettlementAmounts {
  const [clientArvode, clientExp] = [ofKind(s.clientLines, "arvode"), ofKind(s.clientLines, "utlagg")];
  const [payerArvode, payerExp] = [ofKind(s.payerLines, "arvode"), ofKind(s.payerLines, "utlagg")];
  return {
    sjalvriskNetOre: netOreOf(clientArvode), sjalvriskGrossOre: grossOreOf(clientArvode),
    clientExpensesNetOre: netOreOf(clientExp), clientExpensesVatOre: vatOreOf(clientExp), clientExpensesGrossOre: grossOreOf(clientExp),
    payerArvodeNetOre: netOreOf(payerArvode), payerArvodeVatOre: vatOreOf(payerArvode),
    payerExpensesNetOre: netOreOf(payerExp), payerExpensesVatOre: vatOreOf(payerExp), expensesGrossOre: grossOreOf(payerExp),
  };
}
