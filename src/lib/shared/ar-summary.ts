/**
 * Kundfordrings-sammanställning ([ADR 0007]) — ren aggregering, inga DB-anrop.
 * Allt i öre (Int). Livstid som primär vy (inget periodfönster).
 *
 * Bygger på partition-invarianten (#137): per faktura
 *   amount = betalt + krediterat + avskrivet + utestående
 * så aggregerat:
 *   Fakturerat − Krediterat − Inbetalt − Konstaterad kundförlust = Σ Utestående
 *   Netto realiserat = Fakturerat − Krediterat − Konstaterad kundförlust
 *                    = Inbetalt + Utestående
 *
 * Två vyer delar samma per-faktura-ledger:
 *   - kundfordrings-brygga (waterfall)
 *   - åldersanalys (förfallna fakturors utestående i dag-hinkar)
 *
 * [ADR 0007]: ../../../docs/adr/0007-kundfordringar-konstaterad-kundforlust.md
 */

import { computeInvoiceLedger } from "./write-off-calc";

type Row = Record<string, unknown>;

/** Status som räknas som "utställd" (fakturerat). DRAFT/CANCELLED exkluderas. */
const ISSUED_STATUSES = new Set(["SENT", "PAID", "BAD_DEBT", "INSTALLMENT_PLAN"]);

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function coerceDateOrNull(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Summera `amount` per `key`-värde över rader. */
function sumAmountByKey(rows: readonly Row[], key: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[key] ?? "");
    if (k) m.set(k, (m.get(k) ?? 0) + num(r.amount));
  }
  return m;
}

/** Krediterat per ursprungsfaktura (CREDIT-fakturors absolutbelopp). */
function creditedByInvoice(invoices: readonly Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.invoiceType !== "CREDIT") continue;
    const target = String(inv.creditedInvoiceId ?? "");
    if (target) m.set(target, (m.get(target) ?? 0) + Math.abs(num(inv.amount)));
  }
  return m;
}

export interface InvoiceOutstanding {
  invoiceId: string;
  outstanding: number;
  dueDate: Date | null;
}

/** Utestående för EN utställd icke-CREDIT-faktura, annars null. */
function outstandingForInvoice(
  inv: Row,
  paid: Map<string, number>,
  credited: Map<string, number>,
  written: Map<string, number>,
): InvoiceOutstanding | null {
  if (!ISSUED_STATUSES.has(String(inv.status)) || inv.invoiceType === "CREDIT") return null;
  const id = String(inv.id ?? "");
  const ledger = computeInvoiceLedger(num(inv.amount), paid.get(id) ?? 0, credited.get(id) ?? 0, written.get(id) ?? 0);
  return { invoiceId: id, outstanding: ledger.outstanding, dueDate: coerceDateOrNull(inv.dueDate ?? inv.dueAt) };
}

/** Per utställd (icke-CREDIT) faktura: utestående + förfallodatum. */
export function perInvoiceOutstanding(
  invoices: readonly Row[],
  payments: readonly Row[],
  writeOffs: readonly Row[],
): InvoiceOutstanding[] {
  const paid = sumAmountByKey(payments, "invoiceId");
  const credited = creditedByInvoice(invoices);
  const written = sumAmountByKey(writeOffs, "invoiceId");
  const out: InvoiceOutstanding[] = [];
  for (const inv of invoices) {
    const row = outstandingForInvoice(inv, paid, credited, written);
    if (row) out.push(row);
  }
  return out;
}

export interface ArPeriod {
  from: Date;
  to: Date;
}

function issueDateOf(inv: Row): Date | null {
  return coerceDateOrNull(inv.invoiceDate ?? inv.issuedAt);
}

/**
 * Scopa kundfordrings-datat till fakturor UTSTÄLLDA i perioden (invoiceDate ∈
 * [from,to]) — samma nyckel som billed-panelen. Betalningar, krediteringar och
 * avskrivningar tas med för dessa fakturor (oavsett egen datering) så per-faktura-
 * partitionen består. CREDIT-fakturor följer med om de krediterar en periodfaktura.
 */
export function scopeArToPeriod(
  invoices: readonly Row[],
  payments: readonly Row[],
  writeOffs: readonly Row[],
  period: ArPeriod,
): { invoices: Row[]; payments: Row[]; writeOffs: Row[] } {
  const fromMs = period.from.getTime();
  const toMs = period.to.getTime();
  const periodIds = new Set<string>();
  for (const inv of invoices) {
    if (inv.invoiceType === "CREDIT") continue;
    const d = issueDateOf(inv);
    if (d && d.getTime() >= fromMs && d.getTime() <= toMs) periodIds.add(String(inv.id ?? ""));
  }
  const belongs = (inv: Row): boolean =>
    inv.invoiceType === "CREDIT"
      ? periodIds.has(String(inv.creditedInvoiceId ?? ""))
      : periodIds.has(String(inv.id ?? ""));
  return {
    invoices: invoices.filter(belongs),
    payments: payments.filter((p) => periodIds.has(String(p.invoiceId ?? ""))),
    writeOffs: writeOffs.filter((w) => periodIds.has(String(w.invoiceId ?? ""))),
  };
}

/**
 * Attribuera kundfordrings-datat till EN advokat: skala varje fakturas belopp
 * (och dess betalningar/krediteringar/avskrivningar) med advokatens andel
 * (`userWork / totalWork` per faktura, ∈ [0,1]). Droppar fakturor utan andel.
 *
 * Samma attributions-modell som "Fakturerat per advokat" (#90), generaliserad
 * till hela bryggan. Partitionen består eftersom ALLA komponenter skalas med
 * samma andel per faktura. CREDIT-fakturor ärver andelen från fakturan de krediterar.
 */
export function attributeArToLawyer(
  invoices: readonly Row[],
  payments: readonly Row[],
  writeOffs: readonly Row[],
  ratioByInvoice: ReadonlyMap<string, number>,
): { invoices: Row[]; payments: Row[]; writeOffs: Row[] } {
  const ratioForInvoice = (inv: Row): number =>
    inv.invoiceType === "CREDIT"
      ? ratioByInvoice.get(String(inv.creditedInvoiceId ?? "")) ?? 0
      : ratioByInvoice.get(String(inv.id ?? "")) ?? 0;
  const ratioByRow = (row: Row): number => ratioByInvoice.get(String(row.invoiceId ?? "")) ?? 0;
  const scaled = (row: Row, ratio: number): Row => ({ ...row, amount: Math.round(num(row.amount) * ratio) });

  return {
    invoices: invoices.flatMap((i) => { const r = ratioForInvoice(i); return r > 0 ? [scaled(i, r)] : []; }),
    payments: payments.flatMap((p) => { const r = ratioByRow(p); return r > 0 ? [scaled(p, r)] : []; }),
    writeOffs: writeOffs.flatMap((w) => { const r = ratioByRow(w); return r > 0 ? [scaled(w, r)] : []; }),
  };
}

export interface ArBridge {
  fakturerat: number;
  krediterat: number;
  justerat: number;
  inbetalt: number;
  konstateradKundforlust: number;
  utestaende: number;
  ejForfallet: number;
  forfallet: number;
  nettoRealiserat: number;
}

/** Kundfordrings-bryggan (waterfall), livstid. */
export function computeArBridge(
  invoices: readonly Row[],
  payments: readonly Row[],
  writeOffs: readonly Row[],
  now: Date,
): ArBridge {
  const issued = invoices.filter((i) => ISSUED_STATUSES.has(String(i.status)) && i.invoiceType !== "CREDIT");
  const fakturerat = issued.reduce((s, i) => s + num(i.amount), 0);
  const krediterat = invoices
    .filter((i) => i.invoiceType === "CREDIT")
    .reduce((s, i) => s + Math.abs(num(i.amount)), 0);
  const inbetalt = payments.reduce((s, p) => s + num(p.amount), 0);
  const konstateradKundforlust = writeOffs.reduce((s, w) => s + num(w.amount), 0);

  const justerat = fakturerat - krediterat;
  const utestaende = justerat - inbetalt - konstateradKundforlust;
  const nettoRealiserat = justerat - konstateradKundforlust;

  const ledgers = perInvoiceOutstanding(invoices, payments, writeOffs);
  let ejForfallet = 0;
  for (const l of ledgers) {
    if (l.outstanding <= 0) continue;
    if (l.dueDate && l.dueDate.getTime() >= now.getTime()) ejForfallet += l.outstanding;
  }
  const forfallet = utestaende - ejForfallet;

  return { fakturerat, krediterat, justerat, inbetalt, konstateradKundforlust, utestaende, ejForfallet, forfallet, nettoRealiserat };
}

export interface AgingBucket {
  /** Människoläsbar etikett, t.ex. "0–30 dagar". */
  label: string;
  /** Utestående belopp i hinken (öre). */
  amount: number;
}

const AGING_EDGES = [30, 60, 90] as const;
const AGING_LABELS = ["0–30 dagar", "31–60 dagar", "61–90 dagar", ">90 dagar"] as const;

function bucketIndexForDaysOverdue(days: number): number {
  if (days <= AGING_EDGES[0]) return 0;
  if (days <= AGING_EDGES[1]) return 1;
  if (days <= AGING_EDGES[2]) return 2;
  return 3;
}

/** Åldersanalys: förfallna fakturors utestående i dag-hinkar (synliggör eftersläpningen). */
export function computeAging(
  invoices: readonly Row[],
  payments: readonly Row[],
  writeOffs: readonly Row[],
  now: Date,
): AgingBucket[] {
  const amounts: [number, number, number, number] = [0, 0, 0, 0];
  for (const l of perInvoiceOutstanding(invoices, payments, writeOffs)) {
    if (l.outstanding <= 0 || !l.dueDate) continue;
    const days = Math.floor((now.getTime() - l.dueDate.getTime()) / 86_400_000);
    if (days <= 0) continue; // ej förfallet
    const idx = bucketIndexForDaysOverdue(days);
    amounts[idx] = (amounts[idx] ?? 0) + l.outstanding;
  }
  return AGING_LABELS.map((label, i) => ({ label, amount: amounts[i] ?? 0 }));
}
