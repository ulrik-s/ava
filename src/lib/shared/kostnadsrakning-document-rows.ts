/**
 * Kostnadsräkningens rader (#1218): sammanställningen på sida 1 och
 * arbetsredogörelsens avsnitt på sida 2+.
 *
 * Tidsraderna grupperas per kategori och á-pris — samma kategori med olika
 * á-pris (t.ex. två normår) blir var sin rad, så olika taxor aldrig summeras
 * till en gemensam timkostnad (#891). Beloppen är exakt de som räkningen
 * yrkar (Σ radbelopp i öre) — formateringen avrundar ingenting.
 */

import { formatHours, formatOreAsKr, formatPlainKr, formatQuantity, formatRateKr } from "./kr-format";
import { type TimeEntryKind } from "./schemas/enums";

/** En tidsrad som dokumentet behöver (struktur-kompatibel med `TimeLine`). */
export interface KrTimeLineLike {
  date: string;
  description: string;
  minutes: number;
  kind: TimeEntryKind;
  /** Á-pris (öre/h); 0 för per-dag-kategorier och taxeärenden. */
  rateOrePerH: number;
  /** Radens belopp exkl moms (öre); 0 för taxeärenden. */
  amountOre: number;
}

/** En utläggsrad som dokumentet behöver (struktur-kompatibel med `ExpenseLine`). */
export interface KrExpenseLineLike {
  date: string;
  description: string;
  exclVat: number;
  vatRate: number;
  /** Antal (t.ex. 16 mil) — visas bara när även á-pris finns. */
  quantity?: number | undefined;
  /** Á-pris i öre (t.ex. 950 = 9,50 kr/mil). */
  unitPriceOre?: number | undefined;
}

/** En rad i sammanställningen: `ARVODE | 31,35 á 1 626 kr | 50 975,00 kr`. */
export interface KrSummaryRow {
  label: string;
  quantity: string;
  amount: string;
}

/** En sammanställningsrad innan beloppet avrundats och formaterats (öre). */
export interface KrRowSpec {
  label: string;
  quantity: string;
  amountOre: number;
}

/** En rad i arbetsredogörelsen: datum · beskrivning · tid. */
export interface KrSpecRow {
  date: string;
  description: string;
  quantity: string;
}

/** Ett avsnitt i arbetsredogörelsen (Arvode, Tidsspillan, …) med sin summa. */
export interface KrSpecSection {
  heading: string;
  rows: KrSpecRow[];
  sum: string;
}

/** En utläggsrad i arbetsredogörelsen: antal/á-pris bara när de finns. */
export interface KrExpenseSpecRow {
  date: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

/** Arbetsredogörelsens utläggsavsnitt. */
export interface KrExpenseSpec {
  rows: KrExpenseSpecRow[];
  sum: string;
}

/** Kategorinamnen som domstolen ser (avsnittsrubrik; versaler i sammanställningen). */
export const KR_KIND_HEADINGS: Readonly<Record<TimeEntryKind, string>> = {
  ARBETE: "Arvode",
  ARBETE_OBEKVAM_TID: "Arvode obekväm tid",
  TIDSSPILLAN: "Tidsspillan",
  TIDSSPILLAN_OVRIG_TID: "Tidsspillan annan tid",
  ADVOKATBEREDSKAP: "Advokatberedskap",
};

const KIND_ORDER: readonly TimeEntryKind[] = ["ARBETE", "ARBETE_OBEKVAM_TID", "TIDSSPILLAN", "TIDSSPILLAN_OVRIG_TID", "ADVOKATBEREDSKAP"];

const byKindOrder = (a: TimeEntryKind, b: TimeEntryKind): number => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b);

/** Per-dag-kategori (advokatberedskap) — antal dygn i stället för timmar. */
function isPerDay(kind: TimeEntryKind): boolean {
  return kind === "ADVOKATBEREDSKAP";
}

interface Group {
  kind: TimeEntryKind;
  /** Á-pris: öre/h för timkategorier, dagbeloppet för per-dag. */
  unitOre: number;
  minutes: number;
  count: number;
  amountOre: number;
}

function unitOf(l: KrTimeLineLike): number {
  return isPerDay(l.kind) ? l.amountOre : l.rateOrePerH;
}

/**
 * Gruppera tidsraderna per kategori + á-pris, i kategoriordning. En timrads
 * belopp räknas på gruppens SAMMANLAGDA tid (samma som körningens värdering per
 * kategori, `sumKindValueOre`) — inte som summan av avrundade radbelopp.
 */
function groupLines(lines: readonly KrTimeLineLike[]): Group[] {
  const groups = new Map<string, Group>();
  for (const l of lines) {
    const key = `${l.kind}|${unitOf(l)}`;
    const g = groups.get(key) ?? { kind: l.kind, unitOre: unitOf(l), minutes: 0, count: 0, amountOre: 0 };
    groups.set(key, { ...g, minutes: g.minutes + l.minutes, count: g.count + 1, amountOre: g.amountOre + l.amountOre });
  }
  return [...groups.values()]
    .map((g) => (isPerDay(g.kind) ? g : { ...g, amountOre: timeAmountOre(g.minutes, g.unitOre) }))
    .sort((a, b) => byKindOrder(a.kind, b.kind));
}

function groupQuantity(g: Group): string {
  return isPerDay(g.kind)
    ? `${g.count} dygn á ${formatRateKr(g.unitOre)}`
    : `${formatHours(g.minutes)} á ${formatRateKr(g.unitOre)}`;
}

/** Löpande räkning: en sammanställningsrad per kategori och á-pris. */
export function hourlyRowSpecs(lines: readonly KrTimeLineLike[]): KrRowSpec[] {
  return groupLines(lines).map((g) => ({
    label: KR_KIND_HEADINGS[g.kind].toUpperCase(),
    quantity: groupQuantity(g),
    amountOre: g.amountOre,
  }));
}

/** En sammanställningsrad för tid à timpris (t.ex. tidsspillan utöver taxan). */
export function timeRowSpec(label: string, minutes: number, rateOre: number): KrRowSpec {
  return { label, quantity: `${formatHours(minutes)} á ${formatRateKr(rateOre)}`, amountOre: timeAmountOre(minutes, rateOre) };
}

/** Beloppet för minuter à timpris (öre), avrundat till helt öre — samma uttryck
 *  som `timeEntryValueOre`, så dokumentet och körningen räknar lika. */
export function timeAmountOre(minutes: number, rateOre: number): number {
  return Math.round((minutes / 60) * rateOre);
}

/** Formatera en sammanställningsrad med sitt (avrundade) belopp. */
export function formatRow(spec: KrRowSpec, amountOre: number): KrSummaryRow {
  return { label: spec.label, quantity: spec.quantity, amount: formatOreAsKr(amountOre) };
}

/** Utläggsraden i sammanställningen (exkl moms), eller ingen rad utan utlägg. */
export function expenseSummaryRows(lines: readonly KrExpenseLineLike[], exclVatOre: number): KrSummaryRow[] {
  return lines.length === 0 ? [] : [{ label: "UTLÄGG", quantity: "", amount: formatOreAsKr(exclVatOre) }];
}

function specQuantity(l: KrTimeLineLike): string {
  return isPerDay(l.kind) ? "1 dygn" : formatHours(l.minutes);
}

function sectionSum(kind: TimeEntryKind, lines: readonly KrTimeLineLike[]): string {
  return isPerDay(kind) ? `${lines.length} dygn` : formatHours(lines.reduce((s, l) => s + l.minutes, 0));
}

/**
 * Arbetsredogörelsens tidsavsnitt — ett per kategori, raderna i
 * registreringsordning. `suffix` läggs efter rubriken (t.ex. " (ingår i taxan)").
 */
export function timeSpecSections(lines: readonly KrTimeLineLike[], suffix = ""): KrSpecSection[] {
  const kinds = [...new Set(lines.map((l) => l.kind))].sort(byKindOrder);
  return kinds.map((kind) => {
    const own = lines.filter((l) => l.kind === kind);
    return {
      heading: `${KR_KIND_HEADINGS[kind]}${suffix}`,
      rows: own.map((l) => ({ date: l.date, description: l.description, quantity: specQuantity(l) })),
      sum: sectionSum(kind, own),
    };
  });
}

function expenseSpecRow(l: KrExpenseLineLike): KrExpenseSpecRow {
  const priced = l.quantity !== undefined && l.unitPriceOre !== undefined;
  return {
    date: l.date,
    description: l.description,
    quantity: priced ? formatQuantity(l.quantity ?? 0) : "",
    unitPrice: priced ? formatPlainKr(l.unitPriceOre ?? 0) : "",
    amount: formatPlainKr(l.exclVat),
  };
}

/** Arbetsredogörelsens utläggsavsnitt, eller null utan utlägg. */
export function expenseSpec(lines: readonly KrExpenseLineLike[], exclVatOre: number): KrExpenseSpec | null {
  if (lines.length === 0) return null;
  return { rows: lines.map(expenseSpecRow), sum: formatPlainKr(exclVatOre) };
}
