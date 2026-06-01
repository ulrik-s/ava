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

import { computeBrottmalstaxa, computeTimkostnadsnorm, type TaxaLevel, type TaxaResult } from "./brottmalstaxa";
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
   *  Vid false: arvodet räknas via timkostnadsnorm × faktisk tid istället. */
  isTaxeArende?: boolean;
  /** Alla utlägg på ärendet. */
  expenses: readonly ExpenseInput[];
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

export interface KostnadsrakningResult {
  huvudforhandlingMinutes: number;
  taxa: TaxaResult;
  expenseLines: ExpenseLine[];
  expenseSummary: { exclVat: number; vat: number; inclVat: number };
  arvodeExclVat: number;
  arvodeMoms: number;
  arvodeInclVat: number;
  /** Belopp att fakturera staten = arvode inkl moms + utlägg inkl moms. */
  totalInclVat: number;
  templateContext: Record<string, unknown>;
}

/** Icke-taxa-ärende: arvode = timkostnadsnorm × faktisk tid. Returnerar
 *  ett TaxaResult-objekt så övriga delen av flowet är oförändrad. */
function timkostnadsnormResult(huvudforhandlingMinutes: number, hasFTax: boolean): TaxaResult {
  const tk = computeTimkostnadsnorm({ arbetsMinutes: huvudforhandlingMinutes, hasFTax });
  const label = hasFTax ? "Timkostnadsnorm (med F-skatt)" : "Timkostnadsnorm (utan F-skatt)";
  return {
    kind: "taxa-applies",
    level: 1,
    intervalLabel: label,
    ersattningExclVat: tk.total,
    gransvardeExclVat: 0,
    notes: [`Icke-taxa-ärende — timkostnadsnorm ${tk.rateOrePerH / 100} kr/h × ${(huvudforhandlingMinutes / 60).toFixed(2)} h`],
  };
}

// eslint-disable-next-line complexity
export function buildKostnadsrakningContext(input: BuildInput): KostnadsrakningResult {
  const start = new Date(input.hufStart);
  const end = new Date(input.hufEnd);
  const huvudforhandlingMinutes = diffMinutes(start, end);

  const level: TaxaLevel = input.taxaLevel ?? 1;
  const isTaxe = input.isTaxeArende ?? true;
  const taxa: TaxaResult = isTaxe
    ? computeBrottmalstaxa({ huvudforhandlingMinutes, level, hasFTax: input.hasFTax ?? true })
    : timkostnadsnormResult(huvudforhandlingMinutes, input.hasFTax ?? true);

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

  const arvodeExclVat = taxa.kind === "taxa-applies" ? taxa.ersattningExclVat : 0;
  const arvodeMoms = Math.round(arvodeExclVat * 0.25);
  const arvodeInclVat = arvodeExclVat + arvodeMoms;
  const totalInclVat = arvodeInclVat + expenseSummary.inclVat;

  const templateContext: Record<string, unknown> = {
    today: toIsoDate(new Date()),
    matterNumber: input.matter.matterNumber,
    matterTitle: input.matter.title,
    clientName: input.matter.clientName ?? "",
    defenderName: input.defender.name,
    defenderEmail: input.defender.email ?? "",
    organizationName: input.organization?.name ?? "",
    organizationOrgNumber: input.organization?.orgNumber ?? "",
    organizationAddress: input.organization?.address ?? "",
    courtName: input.courtName ?? "",
    hufStart: toIsoDateTime(start),
    hufEnd: toIsoDateTime(end),
    huvudforhandlingMinutes,
    huvudforhandlingFormatted: formatMinutes(huvudforhandlingMinutes),
    taxaLevel: level,
    taxaApplies: taxa.kind === "taxa-applies",
    taxaIntervalLabel: taxa.intervalLabel,
    taxaNotes: taxa.notes,
    arvodeExclVat,
    arvodeMoms,
    arvodeInclVat,
    arvodeExclFormatted: formatOreAsKr(arvodeExclVat),
    arvodeMomsFormatted: formatOreAsKr(arvodeMoms),
    arvodeInclFormatted: formatOreAsKr(arvodeInclVat),
    expenseLines: expenseLines.map((l) => ({
      ...l,
      exclVatFormatted: formatOreAsKr(l.exclVat),
      vatFormatted: formatOreAsKr(l.vat),
      inclVatFormatted: formatOreAsKr(l.inclVat),
      vatRateLabel: vatRateLabel(l.vatRate),
    })),
    expenseSummary: {
      exclVat: expenseSummary.exclVat,
      vat: expenseSummary.vat,
      inclVat: expenseSummary.inclVat,
      exclVatFormatted: formatOreAsKr(expenseSummary.exclVat),
      vatFormatted: formatOreAsKr(expenseSummary.vat),
      inclVatFormatted: formatOreAsKr(expenseSummary.inclVat),
    },
    totalInclVat,
    totalInclFormatted: formatOreAsKr(totalInclVat),
  };

  return {
    huvudforhandlingMinutes,
    taxa,
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
