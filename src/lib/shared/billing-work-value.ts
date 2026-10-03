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
 * ## Hela kronor per rad
 *
 * Allt räknas i heltalsören, men varje RAD fakturan visar — en tidspost, en
 * kategorirad, ett utlägg — avrundas till hela kronor (#1438, `whole-kronor`).
 * Mellansummorna är summor av avrundade rader och avrundas aldrig igen, så
 * fakturan alltid stämmer med sin egen specifikation; momsen räknas på den
 * avrundade summan.
 */

import type { VatBreakdownLine } from "./accounting/semantic-voucher";
import { coverageEntryRateOre, coverageEntryValueOre, isPerDayKind, payableCoverageEntries, type CoverageEntryLike } from "./brottmalstaxa";
import { chargedExpenseLines } from "./expense-vat";
import { krClaim } from "./kr-claim";
import type { PaymentMethod, TimeEntryKind } from "./schemas/enums";
import type { ExpenseId, TimeEntryId } from "./schemas/ids";
import { DEFAULT_VAT_RATE } from "./vat";
import { roundToKronor, timeRowOre, vatOnRow } from "./whole-kronor";

/** Det som behövs för att värdera ARVODET — tidsposternas värderingsfält. */
export interface ArvodeWork {
  timeEntries: ReadonlyArray<{ minutes: number; hourlyRate: number; billable: boolean; date: Date | string; kind?: TimeEntryKind | null | undefined }>;
}

export interface UnfrozenWork {
  timeEntries: Array<{ id: TimeEntryId; minutes: number; hourlyRate: number; billable: boolean; date: Date | string; description: string; kind?: TimeEntryKind | null | undefined }>;
  expenses: Array<{ id: ExpenseId; amount: number; billable: boolean; vatRate?: number | null; vatIncluded?: boolean | null }>;
}

/** Värdet på en (debiterbar) tidspost i öre, oavrundat till kronor — basen som
 *  raderna avrundas ifrån (äldre fakturors specifikation använder det rakt av). */
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
  // Posten är en rad på fakturan → hela kronor (#1438).
  return isPerDayKind(t.kind) ? coverageEntryRowOre(t, t.date) : timeRowOre(t.minutes, t.hourlyRate);
}

/** En post värderad på sin kategoris norm för `date`, som en fakturarad i hela
 *  kronor (#1438): dagbeloppet för per-dygns-kategorier, annars tid × norm. */
export function coverageEntryRowOre(t: CoverageEntryLike, date: Date | string): number {
  return isPerDayKind(t.kind) ? roundToKronor(coverageEntryValueOre(t, date)) : timeRowOre(t.minutes, coverageEntryRateOre(t.kind, date));
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
    .reduce((sum, e) => sum + coverageEntryRowOre(e, settleDate), 0);
}

/** Summera kategoriernas minuter på respektive årsnorm (#950). */
export function sumKindValueOre(byKind: ReadonlyMap<TimeEntryKind, number>, settleDate: Date | string): number {
  let net = 0;
  for (const [kind, minutes] of byKind) net += timeRowOre(minutes, coverageEntryRateOre(kind, settleDate));
  return net;
}

/** En arvode-breakdown-rad (25 % moms) ur ett netto-arvode; null om 0. */
export function arvodeLine(arvodeNet: number): VatBreakdownLine | null {
  if (arvodeNet <= 0) return null;
  return { kind: "arvode", vatRate: DEFAULT_VAT_RATE, netOre: arvodeNet, vatOre: vatOnRow(arvodeNet, DEFAULT_VAT_RATE) };
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
 *  på moms på arvodet oavsett mottagare (#782). Härleds ur SAMMA moms-uppdelning
 *  som fakturan och verifikatet bär, så beloppen aldrig kan skilja (#1438). */
export function invoiceGrossOre(work: UnfrozenWork): number {
  return grossOreOf(invoiceVatBreakdown(work));
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
 * 2025 värderas på 2026 års norm). Arbete värderas på timkostnadsnormen,
 * tidsspillan på tidsspillan-normen, obekväm
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
  return kindValueRowsOre(billable, settleDate).reduce((s, r) => s + r, 0);
}

/**
 * Arvodet per kategori på normerna för `date` (öre): en rad per timkategori och
 * en för beredskapsdygnen — kostnadsräkningens sammanställningsrader (#1218).
 */
function kindValueRowsOre(billable: ArvodeWork["timeEntries"], date: Date | string): number[] {
  // DVFS 2025:9 § 2 (#950): beredskapsdagar som "förbrukats" av en helgförhandling
  // eller ett polisförhör samma dag ersätts inte — arbetet betalas i stället.
  const payable = payableCoverageEntries(billable);
  // Rådgivningstimmen dras INTE av här (#1205): den är en låst post som redan
  // fakturerats klienten och ingår aldrig i underlaget som värderas.
  // Varje kategorirad avrundas till hela kronor — samma rader som kostnadsräkningen (#1218/#1438).
  const rows = [...minutesByKind(payable)].map(([kind, minutes]) => timeRowOre(minutes, coverageEntryRateOre(kind, date)));
  const perDay = perDayValueOre(payable, date);
  return perDay > 0 ? [...rows, perDay] : rows;
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
 * rättsskydd, offentligt uppdrag) värderas på Domstolsverkets normer; privat
 * och taxeärenden på posternas egna á-priser. Förr värderade förslaget alltid
 * på posternas á-pris — en jurist utan timpris gav 0 kr i ett rättshjälpsärende.
 */
export function matterArvodeNet(m: ValuationMatter, work: ArvodeWork, date: Date | string): number {
  return usesOwnRates(m) ? arvodeNetOre(work) : settlementArvodeNet(m.paymentMethod, work, date);
}

/** En enskild tidsposts värde enligt samma regel. */
export function matterEntryValueOre(
  m: ValuationMatter, t: ArvodeWork["timeEntries"][number], date: Date | string,
): number {
  return usesOwnRates(m) ? entryOwnValueOre(t) : coverageEntryRowOre(t, date);
}

/**
 * Kostnadsräkningens arvodesrader enligt ärendets värderingsregel: domstols-
 * ersatta metoder en rad per kategori (Domstolsverkets normer), egna á-priser
 * (taxeärenden) en rad för hela arvodet.
 */
export function matterKrArvodeRows(m: ValuationMatter, work: ArvodeWork, date: Date | string): number[] {
  return usesOwnRates(m) ? [arvodeNetOre(work)] : kindValueRowsOre(work.timeEntries.filter((t) => t.billable), date);
}

/**
 * Kostnadsräkningens yrkade brutto (#1218) — samma avrundning som dokumentet
 * (`krClaim`): varje rad till hela kronor, moms 25 % på summan utom äkta utlägg
 * (#945/#975), avrundad till hela kronor.
 */
export function krGrossOre(work: UnfrozenWork, arvodeRowsOre: readonly number[]): number {
  const lines = expenseBreakdownLines(work);
  const passThrough = netOreOf(lines.filter((l) => l.vatRate === 0));
  return krClaim({ arvodeRowsOre, expenseChargedNetOre: netOreOf(lines) - passThrough, expensePassThroughOre: passThrough }).inclVat;
}
