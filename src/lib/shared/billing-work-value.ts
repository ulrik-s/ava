/**
 * `billing-work-value` — vad arbetet är VÄRT, och hur momsen faller (#1100).
 *
 * ## Varför modulen finns
 *
 * Det här är byråns mest värdeladdade räkning: Domstolsverkets årsnormer, den
 * retroaktiva omräkningen över ett årsskifte, momsuppdelningen enligt
 * NJA 2005 s. 606, och skillnaden mellan vad byrån debiterar och vad staten
 * ersätter. Den låg i `routers/billingRun.ts` och kunde bara nås genom en
 * tRPC-caller — trots att inte en rad av den rör nätet, databasen eller
 * behörigheter.
 *
 * Repot har redan konventionen: `coverage-billing`, `billing-flow`,
 * `invoice-calc` och `kostnadsrakning` är rena moduler i `lib/shared/` med egna
 * tester. Routern bar mer faktureringslogik än de fyra tillsammans.
 *
 * ## Vad som INTE hör hemma här
 *
 * Allt som tar `repos`. Hämtning av ofrysta rader, frysning, bokning av runs
 * och write-back stannar i routern — porten mot datalagret är inte en
 * domänfråga. Gränsen är enkel att hålla: den här filen importerar bara från
 * `@/lib/shared/*`, aldrig från `@/lib/server/*`.
 *
 * ## Öre, inte kronor
 *
 * Allt räknas i heltalsören. Avrundning sker EN gång, vid värderingen av en
 * post (`timeEntryValueOre`), aldrig i mellansummorna — annars ackumuleras
 * ören och fakturan slutar stämma med sin egen specifikation.
 */

import type { VatBreakdownLine } from "./accounting/semantic-voucher";
import { coverageEntryRateOre, coverageEntryValueOre, isPerDayKind, payableCoverageEntries } from "./brottmalstaxa";
import { chargedExpenseLines } from "./expense-vat";
import { arvodeInclVatOre } from "./invoice-calc";
import { RADGIVNING_MINUTES } from "./rattshjalp";
import type { PaymentMethod, TimeEntryKind } from "./schemas/enums";
import type { ExpenseId, TimeEntryId } from "./schemas/ids";
import { DEFAULT_VAT_RATE } from "./vat";

/** Det som behövs för att värdera ARVODET — tidsposternas värderingsfält. */
export interface ArvodeWork {
  timeEntries: ReadonlyArray<{ minutes: number; hourlyRate: number; billable: boolean; date: Date | string; kind?: TimeEntryKind | null | undefined }>;
}

export interface UnfrozenWork {
  timeEntries: Array<{ id: TimeEntryId; minutes: number; hourlyRate: number; billable: boolean; date: Date | string; description: string; kind?: TimeEntryKind | null | undefined }>;
  expenses: Array<{ id: ExpenseId; amount: number; billable: boolean; vatRate?: number | null; vatIncluded?: boolean | null }>;
}

/** Värdet på en (debiterbar) tidspost i öre — speglar workValueOre:s ton. */
export function timeEntryValueOre(minutes: number, hourlyRate: number): number {
  return Math.round((minutes / 60) * hourlyRate);
}

/** Postens värde när det är postens EGEN taxa som gäller (privat/offentligt
 *  uppdrag, fakturaförslaget) — i motsats till täckningsärendenas årsnormer.
 *
 *  Per-dygns-kategorier (#950) värderas ändå på Domstolsverkets dagbelopp för
 *  postens datum: advokatberedskapens garantiersättning är en föreskriven norm
 *  (DVFS 2025:9 § 1), inte byråns timtaxa. Utan undantaget blir de noll —
 *  `minuter × taxa` med noll minuter — och försvinner tyst ur både
 *  kostnadsräkningen och "Upparbetat ofakturerat". */
export function entryOwnValueOre(
  t: { minutes: number; hourlyRate: number; date: Date | string; kind?: TimeEntryKind | null | undefined },
): number {
  return isPerDayKind(t.kind) ? coverageEntryValueOre(t, t.date) : timeEntryValueOre(t.minutes, t.hourlyRate);
}

/**
 * Minuter som rättshjälpsavgiften/coverage-splitten baseras på (#809): rättshjälp
 * exkluderar rådgivningstimmen — ärendets första timme loggas som vanlig tidspost
 * men faktureras klienten separat (rådgivningsavgiften) och ingår INTE i avgifts-
 * basen. Övriga betalningssätt: oförändrat.
 */
export function coverageBaseMinutes(method: PaymentMethod, billableMinutes: number): number {
  return method === "RATTSHJALP" ? Math.max(0, billableMinutes - RADGIVNING_MINUTES) : billableMinutes;
}

/** Debiterbara minuter grupperade per arvodeskategori (#950). */
export function minutesByKind(
  billable: ReadonlyArray<{ minutes: number; kind?: TimeEntryKind | null | undefined }>,
): Map<TimeEntryKind, number> {
  const byKind = new Map<TimeEntryKind, number>();
  for (const t of billable) {
    const kind = t.kind ?? "ARBETE";
    // Per-dygns-kategorier har inga minuter att gruppera (#950) — de värderas
    // av `perDayValueOre` och ska inte belasta timbaserade tak eller carve-outs.
    if (isPerDayKind(kind)) continue;
    byKind.set(kind, (byKind.get(kind) ?? 0) + t.minutes);
  }
  return byKind;
}

/** Summan av per-dygns-posternas garantiersättning på slutregleringsårets
 *  belopp (#950). Anroparen har redan filtrerat bort dagar som § 2 tar. */
export function perDayValueOre(
  entries: ReadonlyArray<{ date: Date | string; minutes: number; kind?: TimeEntryKind | null | undefined }>,
  settleDate: Date | string,
): number {
  return entries
    .filter((e) => isPerDayKind(e.kind))
    .reduce((sum, e) => sum + coverageEntryValueOre(e, settleDate), 0);
}

/** Summera kategoriernas minuter på respektive årsnorm (#950). */
export function sumKindValueOre(byKind: ReadonlyMap<TimeEntryKind, number>, settleDate: Date | string): number {
  let net = 0;
  for (const [kind, minutes] of byKind) net += timeEntryValueOre(minutes, coverageEntryRateOre(kind, settleDate));
  return net;
}

/** En arvode-breakdown-rad (25 % moms) ur ett netto-arvode; null om 0. */
export function arvodeLine(arvodeNet: number): VatBreakdownLine | null {
  if (arvodeNet <= 0) return null;
  return { kind: "arvode", vatRate: DEFAULT_VAT_RATE, netOre: arvodeNet, vatOre: arvodeInclVatOre(arvodeNet) - arvodeNet };
}

/** Utläggens moms-uppdelning: en 25 %-rad (kostnadselement) + en 0 %-rad (äkta
 *  utlägg), enligt NJA 2005 s. 606 (#975). Gäller ALLA betalare. */
export function expenseBreakdownLines(work: UnfrozenWork): VatBreakdownLine[] {
  return chargedExpenseLines(work.expenses.filter((x) => x.billable));
}

/** Summa moms (öre) ur en breakdown. */
export function vatOreOf(lines: VatBreakdownLine[]): number {
  return lines.reduce((s, l) => s + l.vatOre, 0);
}

/** Netto (öre) ur en breakdown. */
export function netOreOf(lines: VatBreakdownLine[]): number {
  return lines.reduce((s, l) => s + l.netOre, 0);
}

/** Brutto (öre) ur en breakdown: netto + moms. */
export function grossOreOf(lines: VatBreakdownLine[]): number {
  return lines.reduce((s, l) => s + l.netOre + l.vatOre, 0);
}

/** Moms (öre) på ett nettobelopp vid standardsatsen. */
export function vatOnNet(netOre: number): number {
  return Math.round((netOre * DEFAULT_VAT_RATE) / 10000);
}

/** Arvode netto (exkl. moms) — summa av debiterbara tidsposter. */
export function arvodeNetOre(work: ArvodeWork): number {
  return payableCoverageEntries(work.timeEntries.filter((t) => t.billable))
    .reduce((sum, t) => sum + entryOwnValueOre(t), 0);
}

/** Debiterbara utlägg, netto (exkl. moms). */
export function expenseNetOre(work: UnfrozenWork): number {
  return netOreOf(expenseBreakdownLines(work));
}

/** Debiterbara utlägg, brutto — det klienten/domstolen betalar. Härleds ur de
 *  DEBITERADE raderna (25 % enligt NJA 2005 s. 606, #975), inte ur de satser
 *  byrån själv betalade. */
export function expenseGrossOre(work: UnfrozenWork): number {
  return grossOreOf(expenseBreakdownLines(work));
}

/** Nettovärde på arbetet: arvode (exkl moms) + utlägg (exkl moms). Bas för
 *  acconto-förslag och "upparbetat ofakturerat" — INTE fakturabeloppet (se invoiceGrossOre). */
export function workValueOre(work: UnfrozenWork): number {
  return arvodeNetOre(work) + expenseNetOre(work);
}

/** Fakturans bruttobelopp: arvode + 25 % moms + utlägg. Alla fakturor lägger
 *  på moms på arvodet oavsett mottagare (#782). */
export function invoiceGrossOre(work: UnfrozenWork): number {
  return arvodeInclVatOre(arvodeNetOre(work)) + expenseGrossOre(work);
}

/** Fakturans moms-uppdelning per sats (#790): en arvode-rad (25 %) + en utläggs-
 *  rad per förekommande momssats. Driver per-sats bokföring i verifikat/SIE. */
export function invoiceVatBreakdown(work: UnfrozenWork): VatBreakdownLine[] {
  const arvode = arvodeLine(arvodeNetOre(work));
  return [...(arvode ? [arvode] : []), ...expenseBreakdownLines(work)];
}

/**
 * Slutregleringens arvode-netto (#891). Domstolsersatta metoder (rättshjälp,
 * rättsskydd, offentligt uppdrag — #1003): räkna om HELA ärendet på
 * SLUTREGLERINGSÅRETS normer — den retroaktiva höjningen över ett årsskifte (arbete
 * 2025 värderas på 2026 års norm). Arbete värderas på timkostnadsnormen (minus
 * rådgivningstimmen vid rättshjälp), tidsspillan på tidsspillan-normen, obekväm
 * tid och beredskap på sina DVFS-belopp. PRIVAT/MIX: posternas egna á-priser.
 */
export function settlementArvodeNet(method: PaymentMethod, work: ArvodeWork, settleDate: Date | string): number {
  const billable = work.timeEntries.filter((t) => t.billable);
  // Varje post värderas på SIN KATEGORIS norm för slutregleringsåret (#949/#950).
  // Tidigare plattade icke-rättshjälp ut allt till ansvarig jurists timtaxa, vilket
  // gjorde att sammanställningens taxerader inte summerade till fakturabeloppet.
  // Domstolsverkets nivåer gäller allt domstolen/staten ersätter: täckningsärenden
  // (#950) OCH offentliga uppdrag (#1003) — domstolen betalar normen, inte vad
  // byrån råkar ta. Bara PRIVAT/MIX debiterar byråns egen taxa (ligger på posten).
  if (method === "PRIVAT" || method === "MIX") return arvodeNetOre(work);
  // DVFS 2025:9 § 2 (#950): beredskapsdagar som "förbrukats" av en helgförhandling
  // eller ett polisförhör samma dag ersätts inte — arbetet betalas i stället.
  const payable = payableCoverageEntries(billable);
  const byKind = minutesByKind(payable);
  // Rådgivningstimmen carvas ur ARBETE (rättshjälp) — den faktureras klienten separat.
  byKind.set("ARBETE", coverageBaseMinutes(method, byKind.get("ARBETE") ?? 0));
  return sumKindValueOre(byKind, settleDate) + perDayValueOre(payable, settleDate);
}

/** Det av ärendet som styr hur arbetet värderas. */
export interface ValuationMatter {
  paymentMethod: PaymentMethod;
  isTaxeArende?: boolean | null | undefined;
}

/** Värderas arbetet på posternas EGNA á-priser? Privat/blandat — och taxeärenden
 *  (offentligt uppdrag), där brottmålstaxan styr och posterna bara är underlag. */
function usesOwnRates(m: ValuationMatter): boolean {
  return m.paymentMethod === "PRIVAT" || m.paymentMethod === "MIX" || (m.paymentMethod === "OFFENTLIGT_UPPDRAG" && m.isTaxeArende === true);
}

/**
 * Ärendets arvode netto — EN regel för förslag, "upparbetat ofakturerat",
 * aconto och kostnadsräkning. Domstolsersatta betalningssätt (rättshjälp,
 * rättsskydd, offentligt uppdrag) värderas på Domstolsverkets normer och
 * rättshjälp utan rådgivningstimmen (den faktureras klienten separat); privat
 * och taxeärenden på posternas egna á-priser. Förr värderade förslaget alltid
 * på posternas á-pris — en jurist utan timpris gav 0 kr i ett rättshjälpsärende.
 */
export function matterArvodeNet(m: ValuationMatter, work: ArvodeWork, date: Date | string): number {
  return usesOwnRates(m) ? arvodeNetOre(work) : settlementArvodeNet(m.paymentMethod, work, date);
}

/** En enskild tidsposts värde enligt samma regel (rådgivningstimmen dras bara av i summan). */
export function matterEntryValueOre(
  m: ValuationMatter, t: ArvodeWork["timeEntries"][number], date: Date | string,
): number {
  return usesOwnRates(m) ? entryOwnValueOre(t) : coverageEntryValueOre(t, date);
}

/** Kostnadsräkningens yrkade brutto — den går ALLTID till domstol, så utläggen
 *  värderas med 25 % moms (#945). `arvodeNet` skiljer sig per betalningssätt. */
export function krGrossOre(work: UnfrozenWork, arvodeNet: number): number {
  return arvodeInclVatOre(arvodeNet) + grossOreOf(expenseBreakdownLines(work));
}
