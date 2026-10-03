/**
 * `kostnadsrakning` — pure helper för att bygga en kostnadsräkning till
 * rätten i taxa-ärenden.
 *
 * I rättssalen är detta ett stress-moment: ordföranden ber om
 * kostnadsräkningen i slutet av HUF, hela rätten väntar, och advokaten
 * måste få fram en korrekt beräkning + mejladress på sekunder. Allt
 * utom HUF-sluttiden är känt i förväg — denna helper räknar ut allt
 * deterministiskt så UI:n bara behöver fråga "när slutar det NU?"
 *
 * Inga side-effects. Returnerar:
 *   - `huvudforhandlingMinutes` — räknat från start-/sluttidsstämpel
 *   - `taxa` — resultatet av computeBrottmalstaxa (kan vara exceeds-max)
 *   - `expenseSummary` — exkl/moms/inkl-summor över alla utlägg
 *   - `expenseLines` — per-utlägg-rader för UI/tabell
 *   - `totals` — total att fakturera staten
 *   - `templateContext` — Handlebars-context (matchar default-mallen)
 */

import { applyNoFTaxFactorForDate, computeBrottmalstaxa, computeTimkostnadsnorm, coverageEntryRateOre, coverageEntryValueOre, isPerDayKind, payableCoverageEntries, timkostnadsnormFtaxForDate, type TaxaLevel, type TaxaResult } from "./brottmalstaxa";
import { CHARGED_EXPENSE_VAT_RATE, expenseNetOre as chargedExpenseNetOre } from "./expense-vat";
import { computeForordnandeErsattning, forhorMinutes, type Forhor, type ForordnandeResult, tidsspillanUtover } from "./forordnandetaxa";
import { isTidsspillanKind } from "./hourly-rate";
import { ARVODE_VAT_BIPS } from "./invoice-calc";
import { toIsoDate, toLocalTime } from "./iso-date";
import { buildKrDocument, krArvodePart, type KrArvodeBasis, type KrArvodePart, type KrDocumentView, type KrHuvudforhandling } from "./kostnadsrakning-document";
import { timeAmountOre } from "./kostnadsrakning-document-rows";
import { krClaim, type KrClaim } from "./kr-claim";
import { formatHours, formatMinutes, formatOreAsKr } from "./kr-format";
import { omitUndefined } from "./omit-undefined";
import type { OrgImage } from "./org-image";
import { radgivningTextRad } from "./rattshjalp";
import type { TimeEntryKind } from "./schemas/enums";
import type { BillingRunId } from "./schemas/ids";
import { isLockedEntry, type LockableEntry } from "./time-entry-lock";
import { roundToKronor, vatOnRow } from "./whole-kronor";

export interface ExpenseInput {
  id: string;
  date: Date | string;
  description: string;
  /** Belopp i öre (innehåller eller exkluderar moms beroende på vatIncluded). */
  amount: number;
  /** Default 2500 (25 %). */
  vatRate?: number;
  /** Default true. */
  vatIncluded?: boolean;
  billable?: boolean;
  /** Antal (t.ex. 16 mil) — visas i arbetsredogörelsen tillsammans med á-pris (#1218). */
  quantity?: number;
  /** Á-pris i öre (t.ex. 950 = 9,50 kr/mil). */
  unitPriceOre?: number;
  /** Äkta utlägg (#975) — vidarefaktureras utan moms. */
  passThrough?: boolean;
}

export interface BuildInput {
  matter: {
    matterNumber: string;
    title: string;
    clientName?: string;
    /** Rättshjälp (#383): klienten har betalat en rådgivningstimme separat →
     *  visa transparens-textraden på kostnadsräkningen (inget belopp). */
    radgivningPaid?: boolean;
    /** Domstolens målnummer (#1218) — rubriken "KOSTNADSRÄKNING i mål …". */
    courtCaseNumber?: string;
  };
  defender: {
    name: string;
    email?: string;
    /** Titel under underskriften, t.ex. "Advokat" (#1218). */
    title?: string;
  };
  organization?: {
    name?: string;
    orgNumber?: string;
    address?: string;
    /** Sidfotens kontaktuppgifter + bankgiro (#1218). */
    phone?: string;
    email?: string;
    bankgiro?: string;
    /** Ort för "{ort} den {datum}"; saknas → adressens postort. */
    city?: string;
    /** Webbplats, logga och sidfotsmärke (byråinställningarna). */
    website?: string;
    logo?: OrgImage;
    footerSeal?: OrgImage;
  };
  /** Domstolens namn (för rubriken i kostnadsräkningen). */
  courtName?: string;
  /** ISO-string eller Date — HUF startade. Saknas i förordnandemål. */
  hufStart?: Date | string;
  /** ISO-string eller Date — HUF slutade (just nu i rättssalen). */
  hufEnd?: Date | string;
  /**
   * Förordnandemål (DVFS 2025:5): förundersökningen lades ned (eller
   * strafföreläggande/inget åtal). Arvodet bestäms då av den sammanlagda
   * förhörstiden i stället för en huvudförhandling, plus tidsspillan utöver den
   * timme som ingår i taxan. Hamnar förhören utanför taxan räknas ärendet löpande.
   */
  forordnande?: { forhor: readonly Forhor[] };
  /**
   * När YRKANDET framställs (#980) — datumet som avgör vilket års normer
   * arbetet värderas på. Default: nu.
   *
   * Övergångsbestämmelserna knyter an till inlämningen, inte till arbetet eller
   * förhandlingen: "Äldre föreskrifter gäller fortfarande i fråga om yrkande om
   * ersättning … som framställs före den 1 januari 2026" (DVFS 2025:4 p. 3;
   * samma lydelse i 2025:6 och 2025:10). Det är därför en taxehöjning slår
   * igenom retroaktivt på gammalt arbete.
   *
   * Värderades tidigare på `hufEnd`. Skillnaden syns bara över ett årsskifte —
   * huvudförhandling i december, räkning i januari — men då blev hela räkningen
   * värderad på fjolårets normer, medan slutregleringen (`billingRun.ts`, som
   * använder fakturadatumet) räknade på det nya året. Samma ärende, två belopp.
   */
  yrkandeDate?: Date | string;
  /** Brottmålstaxa-nivå (1-4). Default 1. Används bara när isTaxeArende=true. */
  taxaLevel?: TaxaLevel;
  /** F-skatt-flagga (DVFS 11 §). Default true. */
  hasFTax?: boolean;
  /** Är detta ett taxa-ärende? Default true (bakåt­kompabilitet).
   *  Vid false: arvodet räknas via timkostnadsnorm × (sum billable tid + HUF). */
  isTaxeArende?: boolean;
  /** Alla utlägg på ärendet. */
  expenses: readonly ExpenseInput[];
  /** Tidsregistreringar på ärendet — inkluderas i specifikationen och i
   *  arvodes-beräkningen för icke-taxa-ärenden. För taxa-ärenden visas de
   *  bara som information; beloppet styrs av taxan. */
  timeEntries?: readonly TimeEntryInput[];
  /** Körningen räkningen hör till (#1205): poster som just den frös är dess
   *  eget underlag. Övriga låsta poster (redan fakturerade/redovisade) utelämnas. */
  ownBillingRunId?: BillingRunId;
}

export interface TimeEntryInput extends LockableEntry {
  id: string;
  date: Date | string;
  description: string;
  minutes: number;
  billable?: boolean;
  /** ARBETE (default) eller TIDSSPILLAN — värderas på tidsspillan-normen (#891). */
  kind?: TimeEntryKind | null | undefined;
}

export interface ExpenseLine {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  vatRate: number;
  exclVat: number;
  vat: number;
  inclVat: number;
  quantity?: number;
  unitPriceOre?: number;
  passThrough?: boolean;
}

export interface TimeLine {
  id: string;
  date: string;
  description: string;
  minutes: number;
  /** Á-pris (öre/tim) raden värderas på (#891): arbete = timkostnadsnormen,
   *  tidsspillan = tidsspillan-normen. 0 för taxa-ärenden (beloppet styrs av taxan). */
  rateOrePerH: number;
  /** Radens belopp exkl moms (öre) = minutes/60 × rateOrePerH. 0 för taxa-ärenden. */
  amountOre: number;
  /** TIDSSPILLAN → visas som tidsspillan-rad; annars arbete. */
  isTidsspillan: boolean;
  /** Kategorin (default ARBETE) — styr avsnitt i arbetsredogörelsen (#1218). */
  kind: TimeEntryKind;
}

export interface KostnadsrakningResult {
  huvudforhandlingMinutes: number;
  taxa: TaxaResult;
  /** Specifikation av billable tidsposter (exkluderar HUF — den anges
   *  separat). Visas alltid i kostnadsräkningen oavsett taxa-läge. */
  timeLines: TimeLine[];
  /** Total billable tid (timeEntries.minutes) — exkl HUF. */
  billableArbetsMinutes: number;
  /** billableArbetsMinutes + huvudforhandlingMinutes = grunden för
   *  icke-taxa-beräkningen. */
  totalArbetsMinutes: number;
  expenseLines: ExpenseLine[];
  expenseSummary: { exclVat: number; vat: number; inclVat: number };
  arvodeExclVat: number;
  arvodeMoms: number;
  arvodeInclVat: number;
  /** Belopp att fakturera staten = arvode inkl moms + utlägg inkl moms. */
  totalInclVat: number;
  /** Dokumentvyn (#1218) — samma som `templateContext.document`. */
  document: KrDocumentView;
  templateContext: Record<string, unknown>;
}

/** Icke-taxa-ärende: arvode = timkostnadsnorm × all billable arbetstid
 *  (timeEntries) + HUF. Returnerar TaxaResult så övriga delen av flowet
 *  är oförändrad. */
function timkostnadsnormResult(totalArbetsMinutes: number, hasFTax: boolean): TaxaResult {
  const tk = computeTimkostnadsnorm({ arbetsMinutes: totalArbetsMinutes, hasFTax });
  return {
    kind: "taxa-applies",
    level: 1,
    intervalLabel: "Timkostnadsnorm",
    ersattningExclVat: tk.total,
    gransvardeExclVat: 0,
    notes: ["Icke-taxa-ärende — ersättning enligt timkostnadsnorm (arbete) resp. tidsspillan-norm; á-pris per rad i tidsspecifikationen."],
  };
}

/** Arvode-beräkning: taxa-ärende → brottmålstaxa, annars timkostnadsnorm. */
function resolveTaxa(
  input: BuildInput,
  huvudforhandlingMinutes: number,
  totalArbetsMinutes: number,
  level: TaxaLevel,
): TaxaResult {
  const isTaxe = input.isTaxeArende ?? true;
  // Yrkandedatumet väljer taxans ÅRGÅNG (#1004), på samma sätt som det väljer
  // timkostnadsnormens år (#980) — övergångsbestämmelserna knyter ersättningen
  // till när räkningen framställs.
  return isTaxe
    ? computeBrottmalstaxa({ huvudforhandlingMinutes, level, hasFTax: input.hasFTax ?? true, yrkandeDate: yrkandeDateOf(input) })
    : timkostnadsnormResult(totalArbetsMinutes, input.hasFTax ?? true);
}

/** Organisations-fält med tom-sträng-defaults (samlar `?.`/`??` på ett ställe). */
function orgContext(organization: BuildInput["organization"]): Record<string, string> {
  const org = organization ?? {};
  return {
    organizationName: org.name ?? "",
    organizationOrgNumber: org.orgNumber ?? "",
    organizationAddress: org.address ?? "",
    organizationPhone: org.phone ?? "",
    organizationEmail: org.email ?? "",
    organizationBankgiro: org.bankgiro ?? "",
  };
}

/** Tidsspillan i de debiterbara raderna — underlaget för "utöver taxan" (#1182). */
function tidsspillanMinutes(billable: readonly TimeEntryInput[]): { vardagMinutes: number; ovrigMinutes: number } {
  return { vardagMinutes: minutesOfKind(billable, "TIDSSPILLAN"), ovrigMinutes: minutesOfKind(billable, "TIDSSPILLAN_OVRIG_TID") };
}

/** Vad arvodet står på: förordnandetaxa, brottmålstaxa eller löpande räkning. */
function arvodeBasis(a: {
  input: BuildInput; ford: ForordnandeResult | null; level: TaxaLevel; taxa: TaxaResult;
  billable: readonly TimeEntryInput[]; yrkandeDate: Date;
}): KrArvodeBasis {
  const { input, ford, level, taxa, billable, yrkandeDate } = a;
  if (ford?.kind === "taxa") return { kind: "forordnande", ford };
  if (input.isTaxeArende ?? true) {
    // DVFS 2025:6 6 §: en timmes tidsspillan ingår i taxan; resten yrkas (#1182).
    return { kind: "brottmalstaxa", level, taxa, tidsspillan: tidsspillanUtover(tidsspillanMinutes(billable), yrkandeDate, input.hasFTax ?? true) };
  }
  return { kind: "lopande", notes: ford?.kind === "utanfor-taxan" ? [UTANFOR_TEXT[ford.reason]] : [] };
}

/** Dokumentvyn (#1218) ur samma underlag som de äldre vy-fälten. */
function krDocument(a: KrTemplateArgs): KrDocumentView {
  const { input } = a;
  return buildKrDocument({
    matterNumber: input.matter.matterNumber,
    courtCaseNumber: input.matter.courtCaseNumber,
    courtName: input.courtName,
    defenderName: input.defender.name,
    defenderTitle: input.defender.title,
    organization: input.organization ?? {},
    hasFTax: input.hasFTax ?? true,
    yrkandeDate: a.yrkandeDate,
    basis: a.basis,
    huf: a.huf,
    timeLines: a.timeLines,
    forhor: input.forordnande?.forhor,
    expenseLines: a.expenseLines,
    claim: a.claim,
    radgivningNotice: radgivningNoticeOf(input),
  });
}

/** #383: rådgivningstimmen redovisas som textrad (utan belopp) — ingår ej
 *  i domstolens kostnadsräkning, klienten har betalat den separat. */
function radgivningNoticeOf(input: BuildInput): string | null {
  return input.matter.radgivningPaid ? radgivningTextRad() : null;
}

interface KrTemplateArgs {
  input: BuildInput;
  start: Date;
  end: Date;
  /** Datumet räkningen framställs på — styr både headern och normvalet (#980). */
  yrkandeDate: Date;
  huvudforhandlingMinutes: number;
  level: TaxaLevel;
  taxa: TaxaResult;
  arvodeExclVat: number;
  arvodeMoms: number;
  arvodeInclVat: number;
  totalInclVat: number;
  expenseLines: ExpenseLine[];
  expenseSummary: { exclVat: number; vat: number; inclVat: number };
  timeLines: TimeLine[];
  billableArbetsMinutes: number;
  totalArbetsMinutes: number;
  ford: ForordnandeResult | null;
  basis: KrArvodeBasis;
  huf: KrHuvudforhandling;
  claim: KrClaim;
}

/** Bygg Handlebars-context (matchar default-mallen). Ren assemblering. */
function buildKrTemplateContext(a: KrTemplateArgs, document: KrDocumentView): Record<string, unknown> {
  return {
    // Dokumentvyn (#1218) — default-mallen och PDF:en ritar ur den. De platta
    // fälten nedan finns kvar för byråernas egna mallar (#852).
    document,
    courtCaseNumber: a.input.matter.courtCaseNumber ?? "",
    defenderTitle: a.input.defender.title ?? "",
    // Räkningens datum = yrkandedatumet (#980), inte "nu": headern och beloppen
    // ska alltid tala om samma dag.
    today: toIsoDate(a.yrkandeDate),
    matterNumber: a.input.matter.matterNumber,
    matterTitle: a.input.matter.title,
    clientName: a.input.matter.clientName ?? "",
    radgivningNotice: radgivningNoticeOf(a.input),
    defenderName: a.input.defender.name,
    defenderEmail: a.input.defender.email ?? "",
    ...orgContext(a.input.organization),
    courtName: a.input.courtName ?? "",
    hufStart: toIsoDateTime(a.start),
    hufEnd: toIsoDateTime(a.end),
    huvudforhandlingMinutes: a.huvudforhandlingMinutes,
    huvudforhandlingFormatted: formatMinutes(a.huvudforhandlingMinutes),
    taxaLevel: a.level,
    taxaApplies: a.taxa.kind === "taxa-applies",
    // Rättshjälp/övrigt värderas på timkostnadsnormen (ej brottmålstaxan) — styr
    // rubrik/etiketter i dokumentet (#863).
    isTimkostnadsnorm: !(a.input.isTaxeArende ?? true),
    taxaIntervalLabel: a.taxa.intervalLabel,
    taxaNotes: a.taxa.notes,
    arvodeExclVat: a.arvodeExclVat,
    arvodeMoms: a.arvodeMoms,
    arvodeInclVat: a.arvodeInclVat,
    arvodeExclFormatted: formatOreAsKr(a.arvodeExclVat),
    arvodeMomsFormatted: formatOreAsKr(a.arvodeMoms),
    arvodeInclFormatted: formatOreAsKr(a.arvodeInclVat),
    expenseLines: a.expenseLines.map((l) => ({
      ...l,
      exclVatFormatted: formatOreAsKr(l.exclVat),
      vatFormatted: formatOreAsKr(l.vat),
      inclVatFormatted: formatOreAsKr(l.inclVat),
      vatRateLabel: vatRateLabel(l.vatRate),
    })),
    expenseSummary: {
      exclVat: a.expenseSummary.exclVat,
      vat: a.expenseSummary.vat,
      inclVat: a.expenseSummary.inclVat,
      exclVatFormatted: formatOreAsKr(a.expenseSummary.exclVat),
      vatFormatted: formatOreAsKr(a.expenseSummary.vat),
      inclVatFormatted: formatOreAsKr(a.expenseSummary.inclVat),
    },
    totalInclVat: a.totalInclVat,
    totalInclFormatted: formatOreAsKr(a.totalInclVat),
    timeLines: a.timeLines.map((t) => ({
      ...t,
      minutesFormatted: formatMinutes(t.minutes),
      // Per rad (#891): antal (h), á-pris (kr/h) och totalt (kr). Tomt á-pris/totalt
      // för taxa-ärenden (rateOrePerH = 0) → mallen visar bara tiden.
      hoursFormatted: formatHoursDecimal(t.minutes),
      rateFormatted: t.rateOrePerH > 0 ? `${formatOreAsKr(t.rateOrePerH)}/h` : "",
      amountFormatted: t.rateOrePerH > 0 ? formatOreAsKr(t.amountOre) : "",
    })),
    billableArbetsMinutes: a.billableArbetsMinutes,
    billableArbetsFormatted: formatMinutes(a.billableArbetsMinutes),
    totalArbetsMinutes: a.totalArbetsMinutes,
    totalArbetsFormatted: formatMinutes(a.totalArbetsMinutes),
    forordnande: forordnandeContext(a.input.forordnande?.forhor, a.ford),
  };
}

/**
 * Datumet som avgör vilket års normer räkningen värderas på (#980) — och som
 * skrivs som räkningens "Datum" i dokumentet. EN härledning, så headern och
 * beloppen aldrig kan hamna på olika år.
 */
function yrkandeDateOf(input: BuildInput): Date {
  return input.yrkandeDate === undefined ? new Date() : new Date(input.yrkandeDate);
}

/**
 * Värdera tidsraderna per kategori (#891): icke-taxa → arbete på timkostnadsnormen
 * och tidsspillan på tidsspillan-normen (vid YRKANDEDATUMET, retroaktivt — #980), så
 * olika taxor aldrig summeras till en gemensam timkostnad. Taxa-ärenden → rateOrePerH
 * = 0 (raderna är informativa; beloppet styrs av taxan). Utbruten så
 * `buildKostnadsrakningContext` håller komplexitet ≤ 8 (#199).
 */
function valuateTimeLines(
  entries: readonly TimeEntryInput[], input: BuildInput, valDate: Date,
): { timeLines: TimeLine[]; arvodeNorm: number } {
  const isTaxe = input.isTaxeArende ?? true;
  const hasFTax = input.hasFTax ?? true;
  const forFTax = (ore: number): number => (hasFTax ? ore : applyNoFTaxFactorForDate(ore, valDate));
  const arvodeNorm = forFTax(timkostnadsnormFtaxForDate(valDate));
  const timeLines = entries.map((t): TimeLine => valuateTimeLine(t, { isTaxe, valDate, forFTax }));
  return { timeLines, arvodeNorm };
}

/**
 * En rad i tidsspecifikationen. Kategorin styr normen (#950/#953): arbete,
 * obekväm tid och de två tidsspillan-nivåerna har var sin årsnorm, och
 * advokatberedskapen ersätts per DAG — den har ingen timnorm alls, så `á-pris`
 * står tomt (0) och beloppet är dagbeloppet.
 *
 * Taxa-ärenden: arbets- och tidsspillan-raderna är informativa (0) — taxan
 * omfattar allt arbete (DVFS 2025:6 5 §), och tidsspillan utöver den timme som
 * ingår yrkas som egen rad (#1182). Beredskapen ligger utanför taxan: den
 * behåller sitt dygnsbelopp och yrkas för sig (#1024).
 */
function valuateTimeLine(
  t: TimeEntryInput,
  ctx: { isTaxe: boolean; valDate: Date; forFTax: (ore: number) => number },
): TimeLine {
  const perDay = isPerDayKind(t.kind);
  const rateOrePerH = ctx.isTaxe || perDay ? 0 : ctx.forFTax(coverageEntryRateOre(t.kind, ctx.valDate));
  // Beredskapen ligger utanför taxan och behåller sitt dygnsbelopp (#1024).
  const amountOre = ctx.isTaxe && !perDay ? 0 : ctx.forFTax(coverageEntryValueOre(t, ctx.valDate));
  return {
    id: t.id, date: toIsoDate(t.date), description: t.description, minutes: t.minutes,
    rateOrePerH, amountOre, isTidsspillan: isTidsspillanKind(t.kind), kind: t.kind ?? "ARBETE",
  };
}

/**
 * Debiterbara tidsposter som ännu inte är redovisade eller fakturerade (#1205).
 * Rådgivningstimmen (rättshjälp) är en sådan: den faktureras klienten direkt efter
 * mötet och registreras som en LÅST post — den ingår därför aldrig här, och ingen
 * annan registrerad tid dras av i dess ställe. Notisen förklarar den för domstolen.
 * DVFS 2025:9 § 2 (#950): beredskapsdagar som förbrukats av en helgförhandling
 * eller ett polisförhör samma dag yrkas inte — arbetet yrkas i stället.
 */
function billableTimeEntriesOf(input: BuildInput): TimeEntryInput[] {
  const open = (input.timeEntries ?? []).filter((t) => t.billable !== false && !isLockedEntry(t, input.ownBillingRunId));
  return payableCoverageEntries(open);
}

/** Vilken grund räkningen står på: förordnandemål, huvudförhandling eller löpande. */
function resolveBasis(original: BuildInput, billable: readonly TimeEntryInput[], yrkandeDate: Date) {
  const ford = forordnandeOf(original, billable, yrkandeDate);
  // Förhör utanför förordnandetaxan (kväll/helg, > 3 h 45 min) → löpande räkning.
  const input: BuildInput = ford?.kind === "utanfor-taxan" ? { ...original, isTaxeArende: false } : original;
  const start = new Date(input.hufStart ?? yrkandeDate);
  const end = new Date(input.hufEnd ?? yrkandeDate);
  return { ford, input, start, end, huvudforhandlingMinutes: ford ? 0 : diffMinutes(start, end) };
}

/**
 * Utläggsrader — bara debiterbara; övriga är byråns egen kostnad. Momsen är den
 * DEBITERADE (#975, NJA 2005 s. 606): byråns ingående moms räknas av och 25 %
 * läggs på; äkta utlägg går vidare utan moms. Samma regel som körningens belopp
 * (`krGrossOre`), så dokumentet och det lagrade yrkandet stämmer. Varje rad är
 * avrundad till hela kronor (#1438) — utläggsavsnittets rader summerar då exakt
 * till sammanställningens utläggsrad.
 */
function expenseLinesOf(expenses: readonly ExpenseInput[]): ExpenseLine[] {
  return expenses.filter((e) => e.billable !== false).map((e) => {
    const exclVat = roundToKronor(chargedExpenseNetOre({ ...e, vatIncluded: e.vatIncluded ?? true }));
    const vat = e.passThrough === true ? 0 : vatOnRow(exclVat, CHARGED_EXPENSE_VAT_RATE);
    return {
      id: e.id, date: toIsoDate(e.date), description: e.description,
      vatRate: e.passThrough === true ? 0 : CHARGED_EXPENSE_VAT_RATE, exclVat, vat, inclVat: exclVat + vat,
      ...omitUndefined({ quantity: e.quantity, unitPriceOre: e.unitPriceOre, passThrough: e.passThrough }),
    };
  });
}

/** Yrkandet (#1218): raderna avrundade till hela kronor, moms 25 % på summan. */
function claimOf(part: KrArvodePart, expenseLines: readonly ExpenseLine[]): KrClaim {
  const passThrough = expenseLines.filter((l) => l.passThrough === true).reduce((s, l) => s + l.exclVat, 0);
  const charged = expenseLines.reduce((s, l) => s + l.exclVat, 0) - passThrough;
  return krClaim({ arvodeRowsOre: part.rows.map((r) => r.amountOre), expenseChargedNetOre: charged, expensePassThroughOre: passThrough });
}

/**
 * Dokumentfälten (#1218) som anroparna hämtar ur ärendet, användaren och
 * byråinställningarna — platta så de kan skickas som props/meta.
 */
export interface KrDocumentFields {
  courtCaseNumber?: string | undefined;
  defenderTitle?: string | undefined;
  organizationPhone?: string | undefined;
  organizationEmail?: string | undefined;
  organizationBankgiro?: string | undefined;
  organizationWebsite?: string | undefined;
  organizationLogo?: OrgImage | undefined;
  organizationFooterSeal?: OrgImage | undefined;
}

/** Lägg dokumentfälten på rätt ställe i `BuildInput` (utelämnade fält rörs inte). */
export function withDocumentFields(input: BuildInput, f: KrDocumentFields): BuildInput {
  return {
    ...input,
    matter: { ...input.matter, ...omitUndefined({ courtCaseNumber: f.courtCaseNumber }) },
    defender: { ...input.defender, ...omitUndefined({ title: f.defenderTitle }) },
    organization: {
      ...input.organization,
      ...omitUndefined({
        phone: f.organizationPhone, email: f.organizationEmail, bankgiro: f.organizationBankgiro,
        website: f.organizationWebsite, logo: f.organizationLogo, footerSeal: f.organizationFooterSeal,
      }),
    },
  };
}

/** Det som påverkar yrkandets BELOPP — `BuildInput` utan dokumentfälten. */
export type KrClaimInput = Omit<BuildInput, "matter" | "defender" | "organization" | "courtName">;

/**
 * Yrkandet inkl. moms — exakt samma beräkning som kostnadsräkningens dokument
 * (#1024). Servern lagrar det som körningens `workValueOreAtRun`, så beslut och
 * prutning räknas mot det belopp domstolen faktiskt fick se.
 */
export function kostnadsrakningClaimInclVat(input: KrClaimInput): number {
  return buildKostnadsrakningContext({ ...input, matter: { matterNumber: "", title: "" }, defender: { name: "" } }).totalInclVat;
}

export function buildKostnadsrakningContext(original: BuildInput): KostnadsrakningResult {
  const yrkandeDate = yrkandeDateOf(original);

  // Tidsregistreringar — bara billable och ej redan fakturerade räknas (samma
  // princip som utlägg). Rådgivningstimmen är redan fakturerad klienten (låst post,
  // #1205) och ligger HELT utanför kostnadsräkningen; notisen förklarar den.
  // DVFS 2025:9 § 2 (#950): beredskapsdagar som förbrukats av en helgförhandling
  // eller ett polisförhör samma dag yrkas inte — arbetet yrkas i stället.
  const billableTimeEntries = billableTimeEntriesOf(original);
  const { ford, input, start, end, huvudforhandlingMinutes } = resolveBasis(original, billableTimeEntries, yrkandeDate);
  const { timeLines, arvodeNorm } = valuateTimeLines(billableTimeEntries, input, yrkandeDate);
  const billableArbetsMinutes = billableTimeEntries.reduce((s, t) => s + t.minutes, 0);
  const totalArbetsMinutes = billableArbetsMinutes + huvudforhandlingMinutes;

  const level: TaxaLevel = input.taxaLevel ?? 1;
  const taxa = ford?.kind === "taxa" ? ford.taxa : resolveTaxa(input, huvudforhandlingMinutes, totalArbetsMinutes, level);

  const expenseLines = expenseLinesOf(input.expenses);

  // Arvodet står på förordnandetaxan, brottmålstaxan eller löpande räkning (arbete
  // + tidsspillan på sina normer + ev. huvudförhandling på arbete-normen, #891).
  // Yrkandet avrundas per rad till hela kronor och momsen på summan (#1218).
  const huf: KrHuvudforhandling = {
    start, end, minutes: huvudforhandlingMinutes, rateOrePerH: arvodeNorm,
    amountOre: Math.round((huvudforhandlingMinutes / 60) * arvodeNorm),
  };
  const basis = arvodeBasis({ input, ford, level, taxa, billable: billableTimeEntries, yrkandeDate });
  const claim = claimOf(krArvodePart(basis, huf, timeLines), expenseLines);
  const arvodeExclVat = claim.arvodeExclVat;
  // Delsummorna (äldre vy-fält): arvodets moms i hela kronor, utläggen tar resten
  // av den avrundade totalmomsen — så arvode + utlägg alltid = yrkandet.
  const arvodeMoms = vatOnRow(arvodeExclVat, ARVODE_VAT_BIPS);
  const expenseVat = claim.vat - arvodeMoms;
  const expenseSummary = { exclVat: claim.expenseExclVat, vat: expenseVat, inclVat: claim.expenseExclVat + expenseVat };
  const arvodeInclVat = arvodeExclVat + arvodeMoms;
  const totalInclVat = claim.inclVat;

  const args: KrTemplateArgs = {
    input, start, end, yrkandeDate, huvudforhandlingMinutes, level, taxa,
    arvodeExclVat, arvodeMoms, arvodeInclVat, totalInclVat,
    expenseLines, expenseSummary, timeLines, billableArbetsMinutes, totalArbetsMinutes, ford,
    basis, huf, claim,
  };
  const document = krDocument(args);
  const templateContext = buildKrTemplateContext(args, document);

  return {
    huvudforhandlingMinutes,
    taxa,
    timeLines,
    billableArbetsMinutes,
    totalArbetsMinutes,
    expenseLines,
    expenseSummary,
    arvodeExclVat,
    arvodeMoms,
    arvodeInclVat,
    totalInclVat,
    document,
    templateContext,
  };
}

// ─── Förordnandemål (DVFS 2025:5) ─────────────────────────────────────────

/** Minuter per tidsspillan-kategori ur de debiterbara raderna. */
function minutesOfKind(entries: readonly TimeEntryInput[], kind: TimeEntryKind): number {
  return entries.filter((t) => t.kind === kind).reduce((s, t) => s + t.minutes, 0);
}

/** Förordnandeersättningen, eller null när ärendet inte är ett förordnandemål. */
function forordnandeOf(input: BuildInput, billable: readonly TimeEntryInput[], yrkandeDate: Date): ForordnandeResult | null {
  if (!input.forordnande) return null;
  const hasFTax = input.hasFTax ?? true;
  // Skälig ersättning = det löpande värdet av det faktiska arbetet — jämförs mot gränsvärdet (10 §).
  const skalig = billable.reduce((s, t) => s + coverageEntryValueOre(t, yrkandeDate), 0);
  return computeForordnandeErsattning({
    forhor: input.forordnande.forhor,
    tidsspillan: { vardagMinutes: minutesOfKind(billable, "TIDSSPILLAN"), ovrigMinutes: minutesOfKind(billable, "TIDSSPILLAN_OVRIG_TID") },
    hasFTax, yrkandeDate,
    skaligErsattningOre: hasFTax ? skalig : applyNoFTaxFactorForDate(skalig, yrkandeDate),
  });
}

const UTANFOR_TEXT = {
  "over-max": "Den sammanlagda förhörstiden överstiger 3 tim 45 min — taxan tillämpas inte, ersättning enligt löpande räkning.",
  "utanfor-tid": "Förhör har hållits utanför vardagar 07.00–18.00 — taxan tillämpas inte, ersättning enligt löpande räkning.",
} as const;

/** Rad för överskjutande tidsspillan, eller null när inget ersätts i kategorin. */
function tidsspillanRad(label: string, minutes: number, rateOre: number): Record<string, string> | null {
  if (minutes <= 0) return null;
  return { label, minutesFormatted: formatMinutes(minutes), rateFormatted: `${formatOreAsKr(rateOre)}/h`, amountFormatted: formatOreAsKr(timeAmountOre(minutes, rateOre)) };
}

/** Kostnadsräkningens förordnande-avsnitt: förhören, taxan och tidsspillan. */
function forordnandeContext(forhor: readonly Forhor[] | undefined, ford: ForordnandeResult | null): Record<string, unknown> | null {
  if (!forhor || !ford) return null;
  const forhorLines = forhor.map((f) => ({
    date: toIsoDate(f.start),
    start: toLocalTime(f.start),
    end: toLocalTime(f.end),
    minutesFormatted: formatMinutes(forhorMinutes(f)),
  }));
  const base = { forhorLines, forhorTotalFormatted: formatMinutes(ford.forhorMinutes) };
  if (ford.kind === "utanfor-taxan") return { ...base, taxaApplies: false, utanforText: UTANFOR_TEXT[ford.reason] };
  const ts = ford.tidsspillan;
  const d = ford.taxa;
  return {
    ...base,
    taxaApplies: true,
    intervalLabel: d.intervalLabel,
    taxaAmountFormatted: formatOreAsKr(d.ersattningExclVat),
    tidsspillanTotalFormatted: formatMinutes(ts.ingarOvrigMinutes + ts.ingarVardagMinutes + ts.extraOvrigMinutes + ts.extraVardagMinutes),
    tidsspillanIngarFormatted: formatMinutes(ts.ingarOvrigMinutes + ts.ingarVardagMinutes),
    tidsspillanRader: [
      tidsspillanRad("Tidsspillan vardag 08–18", ts.extraVardagMinutes, ts.vardagRateOre),
      tidsspillanRad("Tidsspillan annan tid", ts.extraOvrigMinutes, ts.ovrigRateOre),
    ].filter((r) => r !== null),
    tidsspillanAmountFormatted: formatOreAsKr(ts.amountOre),
    gransvardeOverskrids: ford.gransvardeOverskrids,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function diffMinutes(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 60_000);
}

function toIsoDateTime(d: Date): string {
  return `${toIsoDate(d)} ${toLocalTime(d)}`;
}

/** Minuter → decimaltimmar, "4,00 h" (antal-kolumnen i tidsspecifikationen, #891). */
export function formatHoursDecimal(m: number): string {
  return `${formatHours(m)} h`;
}

export { formatMinutes };

function vatRateLabel(bp: number): string {
  return bp === 0 ? "0 %"
    : bp === 600 ? "6 %"
    : bp === 1200 ? "12 %" : "25 %";
}
