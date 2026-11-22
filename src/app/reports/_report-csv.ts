/**
 * Rapporten som CSV för Excel (#1793): byggs i klienten ur `reports.perLawyer`,
 * med samma avsnitt, kolumner och summor som sidans tabeller. Rubrikerna och
 * summeringen finns här och används av både tabellerna och filen, så att de
 * inte kan glida isär. Serialiseringen är grundens (`src/lib/shared/csv.ts`).
 */

import type { inferRouterOutputs } from "@trpc/server";
import { downloadTextFile } from "@/lib/client/download-text";
import { labelForPaymentMethod } from "@/lib/client/labels";
import type { AppRouter } from "@/lib/server/routers/_app";
import { csvHoursFromMinutes, csvKrFromOre, text, toCsv, type CsvCell, type CsvRow } from "@/lib/shared/csv";

/** Advokatrapporten som sidan hämtar. */
export type Report = NonNullable<inferRouterOutputs<AppRouter>["reports"]["perLawyer"]>;
type MatterRow = Report["matters"][number];
type WeekRow = Report["weeklyRows"][number];
type UnbilledRow = Report["unbilled"]["rows"][number];

/** Avsnittens rubriker (tabellernas h2 och filens rubrikrader). */
export const SECTION_TITLES = {
  matters: "Ärenden under perioden",
  weekly: "Timdebitering per vecka",
  unbilled: "Upparbetat, icke fakturerat",
} as const;

/** Kolumnrubrikerna (tabellernas `label` och filens kolumnrubriker). */
export const COLUMN_LABELS = {
  matter: "Ärende",
  client: "Klient",
  payment: "Betalning",
  totalMinutes: "Tid (h)",
  billableMinutes: "Deb. tid (h)",
  workValueOre: "Arbetsvärde",
  expenseOre: "Utlägg",
  week: "Vecka",
  period: "Period",
  timeOre: "Tid",
  total: "Summa",
} as const;

/** Summan av ett numeriskt fält (tabellernas summarader och filens). */
export function sumOf<T>(rows: readonly T[], value: (row: T) => number): number {
  return rows.reduce((s, r) => s + value(r), 0);
}

/** `<nummer> — <rubrik>`, som tabellens ärendelänk. */
export function matterLabel(r: { matterNumber: string; title: string }): string {
  return `${r.matterNumber} — ${r.title}`;
}

/** `ÅÅÅÅ-vNN`, som tabellens veckokolumn. */
export function weekLabel(r: { isoYear: number; week: number }): string {
  return `${r.isoYear}-v${String(r.week).padStart(2, "0")}`;
}

/** Text eller tom cell (där tabellen visar "—"). */
function optional(value: string | null | undefined): CsvCell {
  return value ? text(value) : null;
}

const kr = (ore: number): CsvCell => text(csvKrFromOre(ore));
const hours = (minutes: number): CsvCell => text(csvHoursFromMinutes(minutes));
/** Beloppet, eller tom cell när tabellen visar "—" för 0. */
const krOrEmpty = (ore: number): CsvCell => (ore > 0 ? kr(ore) : null);
const hoursOrEmpty = (minutes: number): CsvCell => (minutes > 0 ? hours(minutes) : null);

/** Ärendets tre textkolumner (Ärende, Klient, Betalning). */
function matterCells(r: MatterRow | UnbilledRow): CsvCell[] {
  return [text(matterLabel(r)), optional(r.client), text(labelForPaymentMethod(r.paymentMethod))];
}

/** Ett avsnitt: rubrikrad, kolumnrubriker, raderna och summaraden. */
function section(title: string, labels: readonly string[], rows: readonly CsvRow[], summary: CsvRow): CsvRow[] {
  return [[text(title)], labels.map(text), ...rows, [text("Summa"), ...summary]];
}

function mattersSection(rows: readonly MatterRow[]): CsvRow[] {
  const L = COLUMN_LABELS;
  const expenses = sumOf(rows, (r) => r.expenseOre);
  return section(
    SECTION_TITLES.matters,
    [L.matter, L.client, L.payment, L.totalMinutes, L.billableMinutes, L.workValueOre, L.expenseOre],
    rows.map((r) => [...matterCells(r), hours(r.totalMinutes), hours(r.billableMinutes), kr(r.workValueOre), krOrEmpty(r.expenseOre)]),
    [null, null, hours(sumOf(rows, (r) => r.totalMinutes)), hours(sumOf(rows, (r) => r.billableMinutes)), kr(sumOf(rows, (r) => r.workValueOre)), krOrEmpty(expenses)],
  );
}

function weeklySection(rows: readonly WeekRow[]): CsvRow[] {
  const L = COLUMN_LABELS;
  return section(
    SECTION_TITLES.weekly,
    [L.week, L.period, L.totalMinutes, L.billableMinutes, L.workValueOre],
    rows.map((r) => [text(weekLabel(r)), text(`${r.start} – ${r.end}`), hoursOrEmpty(r.totalMinutes), hoursOrEmpty(r.billableMinutes), krOrEmpty(r.workValueOre)]),
    [null, hours(sumOf(rows, (r) => r.totalMinutes)), hours(sumOf(rows, (r) => r.billableMinutes)), kr(sumOf(rows, (r) => r.workValueOre))],
  );
}

function unbilledSection(rows: readonly UnbilledRow[]): CsvRow[] {
  const L = COLUMN_LABELS;
  return section(
    SECTION_TITLES.unbilled,
    [L.matter, L.client, L.payment, L.timeOre, L.expenseOre, L.total],
    rows.map((r) => [...matterCells(r), krOrEmpty(r.timeOre), krOrEmpty(r.expenseOre), kr(r.total)]),
    [null, null, kr(sumOf(rows, (r) => r.timeOre)), kr(sumOf(rows, (r) => r.expenseOre)), kr(sumOf(rows, (r) => r.total))],
  );
}

/** Rapportens tre avsnitt, med en tom rad mellan. */
export function reportCsvRows(report: Report): CsvRow[] {
  return [...mattersSection(report.matters), [], ...weeklySection(report.weeklyRows), [], ...unbilledSection(report.unbilled.rows)];
}

/** Ladda ner rapporten som `tidsrapport_<från>_<till>.csv`. Utan rapport görs inget. */
export function exportReportCsv(report: Report | null | undefined, from: string, to: string): void {
  if (!report) return;
  downloadTextFile(`tidsrapport_${from}_${to}.csv`, toCsv(reportCsvRows(report)), "text/csv;charset=utf-8");
}
