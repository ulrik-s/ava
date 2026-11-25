/**
 * Fakturamallens specifikationsdel (#1937): underlaget (fakturans egna rader
 * eller nedbrytningens arbete) och sida 2+ — tidsspecifikationen per
 * arvodeskategori med delsumma och utläggsspecifikationen. Utbruten ur
 * `faktura-template.ts`, som bygger vy-modellen och läser härifrån.
 *
 * Typerna här är strukturella (fakturans belopp och avrundning, nedbrytningens
 * arbete), så modulen importerar inget ur `faktura-template.ts` och ger ingen
 * cirkel.
 */

import { isPerDayKind, tidsspillanFtaxForDate, tidsspillanOvrigFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { buildInvoiceSpecification, type InvoiceSpecification, type SpecExpenseLine } from "@/lib/shared/invoice-specification";
import { formatDecimalHours } from "@/lib/shared/kr-format";
import { TIME_ENTRY_KIND_LABELS, type AmountRounding, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import { svd as svDate } from "@/lib/shared/settlement-view"; // svensk kalenderdag (#1677)
import { roundingOf } from "@/lib/shared/whole-kronor";

/** Formaterar öre till text (`formatCurrency` i appen). */
export type Fc = (ore: number) => string;

/** En post i nedbrytningens upparbetade arbete (#880). */
export interface CarriedWorkLine { date: string | Date; description: string; minutes: number; amountOre: number; kind?: TimeEntryKind | null | undefined }

/** En tidspost. Inget pris per post (#1439): posterna står under sin kategori,
 *  och kategorins timpris står i sammanställningen. */
export interface FakturaTimeRow { date: string; description: string; hours: string; amount: string }

/** Tidsspecifikationens deltabell för EN arvodeskategori (#1200) — rubrik,
 *  poster och delsumma ("Summa tidsspillan …: 3 tim — 4 461 kr"). */
export interface FakturaTimeGroup { label: string; lines: FakturaTimeRow[]; subtotalLabel: string; hours: string; amount: string }

export interface FakturaExpenseRow { date: string; description: string; net: string; gross: string }

/** Det specifikationen byggs ur: fakturans belopp och avrundning, dess egen
 *  specifikation och nedbrytningens arbete. */
interface SpecSource {
  invoice: { amount: number; amountRounding?: AmountRounding | null | undefined };
  spec?: InvoiceSpecification | null | undefined;
  breakdown?: CarriedWork | null | undefined;
}

/** Nedbrytningens underlag: upparbetat arbete (#880) och utlägg (#1938). */
interface CarriedWork {
  timeLines?: ReadonlyArray<CarriedWorkLine> | undefined;
  expenseLines?: ReadonlyArray<SpecExpenseLine> | undefined;
}

/**
 * Specifikationens underlag (#937): fakturans EGNA länkade rader när de finns,
 * annars nedbrytningens upparbetade arbete (#880) och utlägg (#1938) — klientens
 * självrisk-faktura och aconton har inga egna tidsposter (arbetet bärs av
 * betalar-fakturan), men ska ändå redovisa vad beloppet bygger på. Ren funktion.
 */
export function resolveSpec(a: SpecSource): InvoiceSpecification | null {
  const { spec, breakdown } = a;
  if (spec && spec.timeLines.length > 0) return spec;
  if (!breakdown || !hasCarriedWork(breakdown)) return spec ?? null;
  return specFromCarriedWork(breakdown, spec, a.invoice);
}

/** Bär nedbrytningen något underlag: tidsrader eller utläggsrader (#1938)? */
function hasCarriedWork(b: CarriedWork): boolean {
  return (b.timeLines?.length ?? 0) > 0 || (b.expenseLines?.length ?? 0) > 0;
}

/** Bygg specifikationen ur nedbrytningens arbete och utlägg; spec:ens utlägg om
 *  nedbrytningen saknar egna, och spec:ens avdrag. */
function specFromCarriedWork(carried: CarriedWork, spec: InvoiceSpecification | null | undefined, invoice: SpecSource["invoice"]): InvoiceSpecification {
  return buildInvoiceSpecification({
    timeLines: (carried.timeLines ?? []).map((l) => ({ date: l.date, description: l.description, minutes: l.minutes, amountOre: l.amountOre, kind: l.kind })),
    expenseLines: carried.expenseLines ? [...carried.expenseLines] : spec?.expenseLines ?? [],
    deductions: spec?.deductions ?? [],
    payableOre: invoice.amount,
    // Summeras med fakturans EGET avrundningssätt (#1438) — en äldre faktura
    // visar samma moms som när den skapades.
    rounding: roundingOf(invoice),
  });
}

/** En tidspost i den upplösta specifikationen. */
export type SpecLine = InvoiceSpecification["timeLines"][number];

/** Kategori-ordning i sammanställning och specifikation: arbete först, tidsspillan sist. */
const KIND_ORDER = Object.keys(TIME_ENTRY_KIND_LABELS) as TimeEntryKind[];

/**
 * Postens pris per enhet (öre, exkl moms): dagbeloppet för per-dygns-kategorier
 * (advokatberedskap har ingen timnorm, #950), annars timpriset ur belopp/minuter.
 */
export function unitRateOre(l: SpecLine): number {
  if (isPerDayKind(l.kind)) return l.amountOre;
  return l.minutes > 0 ? Math.round((l.amountOre * 60) / l.minutes) : 0;
}

/**
 * Postens arvodeskategori (#925/#953). Bär raden sin ARVODESKATEGORI används
 * den — det är den enda uppgift som faktiskt avgör vilken norm posten ersätts på.
 * Att gissa ur timtaxan räcker inte: efter en retroaktiv höjning värderas posten
 * på slutregleringsårets norm men bär sitt eget datum, och två tidsspillan-normer
 * kan inte skiljas från arvodet på beloppet.
 *
 * Äldre fakturor (persisterade före #953) saknar kategorin. För dem räddas de två
 * tidsspillan-normerna ur taxan — resten är arvode.
 */
function resolveKind(l: SpecLine): TimeEntryKind {
  if (l.kind) return l.kind;
  const rateOre = unitRateOre(l);
  if (rateOre === tidsspillanFtaxForDate(l.date)) return "TIDSSPILLAN";
  if (rateOre === tidsspillanOvrigFtaxForDate(l.date)) return "TIDSSPILLAN_OVRIG_TID";
  return "ARBETE";
}

/** Tidsposterna per kategori, i KIND_ORDER; tomma kategorier utelämnas. */
export function groupByKind(lines: readonly SpecLine[]): Array<{ kind: TimeEntryKind; lines: SpecLine[] }> {
  return KIND_ORDER
    .map((kind) => ({ kind, lines: lines.filter((l) => resolveKind(l) === kind) }))
    .filter((g) => g.lines.length > 0);
}

/** Summan av `pick` över raderna. */
export const sumOf = <T>(lines: readonly T[], pick: (l: T) => number): number => lines.reduce((s, l) => s + pick(l), 0);

/** Omfattningen: timmar ("2,5") — eller antal dygn för per-dygns-kategorier. */
export function quantityLabel(kind: TimeEntryKind, lines: readonly SpecLine[]): string {
  return isPerDayKind(kind) ? `${lines.length} dygn` : formatDecimalHours(sumOf(lines, (l) => l.minutes));
}

/** En tidspost i specifikationen — omfattning och belopp, inget pris (#1439). */
function timeRow(l: SpecLine, fc: Fc): FakturaTimeRow {
  return { date: svDate(l.date), description: l.description, hours: quantityLabel(resolveKind(l), [l]), amount: fc(l.amountOre) };
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** Tidsspecifikationen per arvodeskategori med delsumma (#1200). */
function timeGroups(spec: InvoiceSpecification, fc: Fc): FakturaTimeGroup[] {
  return groupByKind(spec.timeLines).map(({ kind, lines }) => ({
    label: TIME_ENTRY_KIND_LABELS[kind],
    lines: lines.map((l) => timeRow(l, fc)),
    subtotalLabel: `Summa ${lowerFirst(TIME_ENTRY_KIND_LABELS[kind])}`,
    hours: quantityLabel(kind, lines),
    amount: fc(sumOf(lines, (l) => l.amountOre)),
  }));
}

/** Specifikationens tabeller i vy-modellen. */
interface SpecTables { hasSpec: boolean; timeLines: FakturaTimeRow[]; timeGroups: FakturaTimeGroup[]; expenseLines: FakturaExpenseRow[] }

/** Specifikationens tabeller (tider + utlägg) ur den upplösta specifikationen. */
export function specTables(spec: InvoiceSpecification | null, fc: Fc): SpecTables {
  if (!spec) return { hasSpec: false, timeLines: [], timeGroups: [], expenseLines: [] };
  return {
    hasSpec: spec.timeLines.length > 0 || spec.expenseLines.length > 0,
    timeLines: spec.timeLines.map((l) => timeRow(l, fc)),
    timeGroups: timeGroups(spec, fc),
    expenseLines: spec.expenseLines.map((l) => ({ date: svDate(l.date), description: l.description, net: fc(l.netOre), gross: fc(l.grossOre) })),
  };
}

type SpecExpense = InvoiceSpecification["expenseLines"][number];

/** Utläggens summarad (#1506) — posternas netto/brutto summerade, tomma utan utlägg. */
export function expenseTotals(spec: InvoiceSpecification | null, fc: Fc): { expenseNetTotal: string; expenseGrossTotal: string } {
  const lines: readonly SpecExpense[] = spec?.expenseLines ?? [];
  if (lines.length === 0) return { expenseNetTotal: "", expenseGrossTotal: "" };
  return { expenseNetTotal: fc(sumOf(lines, (l) => l.netOre)), expenseGrossTotal: fc(sumOf(lines, (l) => l.grossOre)) };
}
