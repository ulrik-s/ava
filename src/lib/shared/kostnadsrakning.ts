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

import { computeBrottmalstaxa, computeTimkostnadsnorm, TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H, timkostnadsnormFtaxForDate, tidsspillanFtaxForDate, type TaxaLevel, type TaxaResult } from "./brottmalstaxa";
import { RADGIVNING_MINUTES, radgivningTextRad } from "./rattshjalp";
import { splitVat } from "./vat";

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
}

export interface BuildInput {
  matter: {
    matterNumber: string;
    title: string;
    clientName?: string;
    /** Rättshjälp (#383): klienten har betalat en rådgivningstimme separat →
     *  visa transparens-textraden på kostnadsräkningen (inget belopp). */
    radgivningPaid?: boolean;
  };
  defender: {
    name: string;
    email?: string;
  };
  organization?: {
    name?: string;
    orgNumber?: string;
    address?: string;
  };
  /** Domstolens namn (för rubriken i kostnadsräkningen). */
  courtName?: string;
  /** ISO-string eller Date — HUF startade. */
  hufStart: Date | string;
  /** ISO-string eller Date — HUF slutade (just nu i rättssalen). */
  hufEnd: Date | string;
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
}

export interface TimeEntryInput {
  id: string;
  date: Date | string;
  description: string;
  minutes: number;
  billable?: boolean;
  /** ARBETE (default) eller TIDSSPILLAN — värderas på tidsspillan-normen (#891). */
  kind?: "ARBETE" | "TIDSSPILLAN" | null;
}

export interface ExpenseLine {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  vatRate: number;
  exclVat: number;
  vat: number;
  inclVat: number;
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

/**
 * Ta bort de FÖRSTA `carveMinutes` (kronologiskt) ur listan (#868) — rådgivnings-
 * timmen är ärendets första timme, faktureras klienten separat och ligger utanför
 * domstolens kostnadsräkning. Hela poster utelämnas tills kvoten är uppfylld; en
 * post som delvis överlappar krymps med resterande minuter.
 */
export function carveEarliestMinutes<T extends { date: Date | string; minutes: number }>(
  entries: readonly T[],
  carveMinutes: number,
): T[] {
  const sorted = [...entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let left = carveMinutes;
  const out: T[] = [];
  for (const t of sorted) {
    if (left <= 0) { out.push(t); continue; }
    if (t.minutes <= left) { left -= t.minutes; continue; } // hela posten är rådgivning → utelämna
    out.push({ ...t, minutes: t.minutes - left }); // delvis → krymp
    left = 0;
  }
  return out;
}

/** Arvode-beräkning: taxa-ärende → brottmålstaxa, annars timkostnadsnorm. */
function resolveTaxa(
  input: BuildInput,
  huvudforhandlingMinutes: number,
  totalArbetsMinutes: number,
  level: TaxaLevel,
): TaxaResult {
  const isTaxe = input.isTaxeArende ?? true;
  return isTaxe
    ? computeBrottmalstaxa({ huvudforhandlingMinutes, level, hasFTax: input.hasFTax ?? true })
    : timkostnadsnormResult(totalArbetsMinutes, input.hasFTax ?? true);
}

/** Organisations-fält med tom-sträng-defaults (samlar `?.`/`??` på ett ställe). */
function orgContext(organization: BuildInput["organization"]): Record<string, string> {
  const org = organization ?? {};
  return {
    organizationName: org.name ?? "",
    organizationOrgNumber: org.orgNumber ?? "",
    organizationAddress: org.address ?? "",
  };
}

interface KrTemplateArgs {
  input: BuildInput;
  start: Date;
  end: Date;
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
}

/** Bygg Handlebars-context (matchar default-mallen). Ren assemblering. */
function buildKrTemplateContext(a: KrTemplateArgs): Record<string, unknown> {
  return {
    today: toIsoDate(new Date()),
    matterNumber: a.input.matter.matterNumber,
    matterTitle: a.input.matter.title,
    clientName: a.input.matter.clientName ?? "",
    // #383: rådgivningstimmen redovisas som textrad (utan belopp) — ingår ej
    // i domstolens kostnadsräkning, klienten har betalat den separat.
    radgivningNotice: a.input.matter.radgivningPaid ? radgivningTextRad() : null,
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
  };
}

/**
 * Värdera tidsraderna per kategori (#891): icke-taxa → arbete på timkostnadsnormen
 * och tidsspillan på tidsspillan-normen (vid KR-datumet `hufEnd`, retroaktivt), så
 * olika taxor aldrig summeras till en gemensam timkostnad. Taxa-ärenden → rateOrePerH
 * = 0 (raderna är informativa; beloppet styrs av taxan). Utbruten så
 * `buildKostnadsrakningContext` håller komplexitet ≤ 8 (#199).
 */
function valuateTimeLines(entries: readonly TimeEntryInput[], input: BuildInput): { timeLines: TimeLine[]; arvodeNorm: number } {
  const isTaxe = input.isTaxeArende ?? true;
  const hasFTax = input.hasFTax ?? true;
  const valDate = new Date(input.hufEnd);
  const arvodeNorm = hasFTax ? timkostnadsnormFtaxForDate(valDate) : TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H;
  const tidsNorm = hasFTax ? tidsspillanFtaxForDate(valDate) : TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H;
  const timeLines = entries.map((t): TimeLine => {
    const isTids = t.kind === "TIDSSPILLAN";
    const rateOrePerH = isTaxe ? 0 : (isTids ? tidsNorm : arvodeNorm);
    return {
      id: t.id, date: toIsoDate(t.date), description: t.description, minutes: t.minutes,
      rateOrePerH, amountOre: Math.round((t.minutes / 60) * rateOrePerH), isTidsspillan: isTids,
    };
  });
  return { timeLines, arvodeNorm };
}

export function buildKostnadsrakningContext(input: BuildInput): KostnadsrakningResult {
  const start = new Date(input.hufStart);
  const end = new Date(input.hufEnd);
  const huvudforhandlingMinutes = diffMinutes(start, end);

  // Tidsregistreringar — bara billable räknas (samma princip som utlägg).
  // Rådgivningstimmen (ärendets FÖRSTA timme) faktureras klienten separat och
  // ligger HELT utanför kostnadsräkningen till domstolen (#868): den carvas bort
  // ur BÅDE tidsspecifikationen och arvodes-underlaget — annars ser det ut som att
  // domstolen debiteras för samma timme (dubbel-debitering). Notisen förklarar den.
  const allBillable = (input.timeEntries ?? []).filter((t) => t.billable !== false);
  const billableTimeEntries = input.matter.radgivningPaid
    ? carveEarliestMinutes(allBillable, RADGIVNING_MINUTES)
    : allBillable;
  const { timeLines, arvodeNorm } = valuateTimeLines(billableTimeEntries, input);
  const billableArbetsMinutes = billableTimeEntries.reduce((s, t) => s + t.minutes, 0);
  const totalArbetsMinutes = billableArbetsMinutes + huvudforhandlingMinutes;

  const level: TaxaLevel = input.taxaLevel ?? 1;
  const taxa = resolveTaxa(input, huvudforhandlingMinutes, totalArbetsMinutes, level);

  // Bara billable utlägg ska faktureras — non-billable är firmans egen kostnad.
  const expenses = input.expenses.filter((e) => e.billable !== false);

  const expenseLines: ExpenseLine[] = expenses.map((e) => {
    const r = splitVat({
      amount: e.amount,
      vatRate: e.vatRate ?? 2500,
      vatIncluded: e.vatIncluded ?? true,
    });
    return {
      id: e.id,
      date: toIsoDate(e.date),
      description: e.description,
      vatRate: e.vatRate ?? 2500,
      exclVat: r.exclVat,
      vat: r.vat,
      inclVat: r.inclVat,
    };
  });

  const expenseSummary = expenseLines.reduce(
    (s, l) => ({ exclVat: s.exclVat + l.exclVat, vat: s.vat + l.vat, inclVat: s.inclVat + l.inclVat }),
    { exclVat: 0, vat: 0, inclVat: 0 },
  );

  // Icke-taxa: arvodet = Σ per-rad-belopp (arbete + tidsspillan på sina normer) +
  // ev. huvudförhandling (arbete-norm). Taxa-ärenden: taxans fasta belopp (#891).
  const icketaxaArvode = timeLines.reduce((s, l) => s + l.amountOre, 0)
    + Math.round((huvudforhandlingMinutes / 60) * arvodeNorm);
  const arvodeExclVat = (input.isTaxeArende ?? true)
    ? (taxa.kind === "taxa-applies" ? taxa.ersattningExclVat : 0)
    : icketaxaArvode;
  const arvodeMoms = Math.round(arvodeExclVat * 0.25);
  const arvodeInclVat = arvodeExclVat + arvodeMoms;
  const totalInclVat = arvodeInclVat + expenseSummary.inclVat;

  const templateContext = buildKrTemplateContext({
    input, start, end, huvudforhandlingMinutes, level, taxa,
    arvodeExclVat, arvodeMoms, arvodeInclVat, totalInclVat,
    expenseLines, expenseSummary, timeLines, billableArbetsMinutes, totalArbetsMinutes,
  });

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
    templateContext,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function diffMinutes(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 60_000);
}

function toIsoDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function toIsoDateTime(d: Date): string {
  return `${toIsoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Minuter → decimaltimmar, "4,00 h" (antal-kolumnen i tidsspecifikationen, #891). */
export function formatHoursDecimal(m: number): string {
  return `${new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(m / 60)} h`;
}

export function formatMinutes(m: number): string {
  if (m <= 0) return "0 min";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  if (rest === 0) return `${h} tim`;
  return `${h} tim ${rest} min`;
}

function formatOreAsKr(ore: number): string {
  const kr = ore / 100;
  return new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(kr) + " kr";
}

function vatRateLabel(bp: number): string {
  return bp === 0 ? "0 %"
    : bp === 600 ? "6 %"
    : bp === 1200 ? "12 %" : "25 %";
}
