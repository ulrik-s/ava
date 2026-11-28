/**
 * Fakturans avräkningstabell och summeringsruta (#2255; intag #151) —
 * nedbrytningen (självrisk, rättsskydd, aconto, prutning, rådgivning) som en
 * TABELL med kolumnerna Avräkning | Underlag | Andel | Belopp i st.f. löptext.
 *
 * Bara presentation: beloppen är nedbrytningens egna (`SettlementRow`), inget
 * räknas om. Tabellens regel:
 *   - rader med `role: "basis"` bygger underlaget — beloppet står i Underlag,
 *   - rader med `role: "subtotal"` är mellansummor — utelämnas (tabellen summerar),
 *   - info-rader (spårbarhet) står dämpade, beloppet i parentes under Underlag,
 *   - övriga rader räknas i Belopp, med `basisOre`/`shareBips` i Underlag/Andel.
 * De räknade raderna summerar EXAKT till totalen: skiljer det några ören läggs
 * en uttrycklig rad "Öresutjämning" till. Äldre nedbrytningar (sparade före
 * #2255, utan tabellfälten) ritas rad för rad som förut, utan utjämning.
 */

import type { InvoiceSpecification } from "@/lib/shared/billing/invoice-specification";
import { isVat25, type SettlementRow } from "@/lib/shared/billing/settlement-row";
import { shareLabel, svd as svDate } from "@/lib/shared/billing/settlement-view";
import type { Fc } from "./faktura-spec-view";

/** En rad i avräkningstabellen, färdigformaterad. Tomma fält = tom cell. */
export interface FakturaSettlementRow {
  label: string;
  basis: string;
  share: string;
  amount: string;
  muted: boolean;
}

/** En rad i tabellen innan formatering (öre). `amountOre` satt = räknas i Belopp. */
export interface SettlementTableRow {
  label: string;
  basisOre?: number | undefined;
  /** Underlaget står som avdrag (−) eller i parentes (info). */
  basisStyle: "plain" | "deduct" | "info";
  shareBips?: number | undefined;
  amountOre?: number | undefined;
  muted: boolean;
}

const ROUNDING_LABEL = "Öresutjämning";

/** Har nedbrytningen tabellfälten (#2255)? Annars är den sparad före tabellen. */
export function hasTableFields(rows: readonly SettlementRow[]): boolean {
  return rows.some((r) => r.role !== undefined || r.basisOre !== undefined || r.shareBips !== undefined);
}

const signed = (r: SettlementRow): number => (r.kind === "deduct" ? -r.amountOre : r.amountOre);

/** En nedbrytningsrad som tabellrad; `null` = utelämnas (mellansumma). */
function tableRow(r: SettlementRow): SettlementTableRow | null {
  if (r.role === "subtotal") return null;
  if (r.kind === "info") return { label: r.label, basisOre: r.amountOre, basisStyle: "info", muted: true };
  if (r.role === "basis") return { label: r.label, basisOre: r.amountOre, basisStyle: r.kind === "deduct" ? "deduct" : "plain", muted: false };
  return { label: r.label, basisOre: r.basisOre, basisStyle: "plain", shareBips: r.shareBips, amountOre: signed(r), muted: false };
}

/**
 * Tabellraderna i öre. `reconcile`: lägg till "Öresutjämning" när de räknade
 * raderna inte går jämnt ut på `totalOre` (av för äldre nedbrytningar, vars
 * trappa kan ha mellansummor utan markering).
 */
export function settlementTable(rows: readonly SettlementRow[], totalOre: number, reconcile: boolean): SettlementTableRow[] {
  const table = rows.map(tableRow).filter((r): r is SettlementTableRow => r !== null);
  const diffOre = totalOre - table.reduce((s, r) => s + (r.amountOre ?? 0), 0);
  if (!reconcile || diffOre === 0) return table;
  return [...table, { label: ROUNDING_LABEL, basisStyle: "plain", amountOre: diffOre, muted: false }];
}

/** Underlagscellen: belopp, avdrag (−) eller info (parentes). */
function basisText(r: SettlementTableRow, fc: Fc): string {
  if (r.basisOre === undefined) return "";
  if (r.basisStyle === "info") return `(${fc(r.basisOre)})`;
  return r.basisStyle === "deduct" ? `−${fc(r.basisOre)}` : fc(r.basisOre);
}

/** Formatera tabellraderna. */
export function formatSettlementRows(rows: readonly SettlementTableRow[], fc: Fc): FakturaSettlementRow[] {
  return rows.map((r) => ({
    label: r.label,
    basis: basisText(r, fc),
    share: r.shareBips === undefined ? "" : `${shareLabel(r.shareBips)} %`,
    amount: r.amountOre === undefined ? "" : fc(r.amountOre),
    muted: r.muted,
  }));
}

/**
 * Slutfakturans avräkning utan nedbrytning (#856): summan enligt
 * sammanställningen, avdragna aconton och ev. justering — summerar till fakturans
 * belopp (`adjustmentOre` fångar differensen).
 */
export function specSettlementRows(spec: InvoiceSpecification): SettlementRow[] {
  const deductionOre = spec.deductions.reduce((s, d) => s + d.amountOre, 0);
  const rows: SettlementRow[] = [
    { label: "Summa enligt fakturaraderna (inkl moms)", amountOre: spec.payableOre + deductionOre - spec.adjustmentOre, kind: "add" },
    ...spec.deductions.map((d): SettlementRow => ({
      label: `Avgår aconto — faktura ${d.invoiceNumber}${d.date ? ` (${svDate(d.date)})` : ""}`, amountOre: d.amountOre, kind: "deduct",
    })),
  ];
  if (spec.adjustmentOre !== 0) rows.push({ label: spec.adjustmentOre < 0 ? "Nedsättning" : "Justering", amountOre: spec.adjustmentOre, kind: "add" });
  return rows;
}

/** Summeringsrutan: exkl moms, moms (med 25 % när hela underlaget bär det) och inkl moms. */
export interface FakturaTotals {
  exclVat: string;
  vatLabel: string;
  vat: string;
  inclVat: string;
}

/** Summeringsrutan ur fakturans belopp och moms (samma moms som verifikatet). */
export function fakturaTotals(amountOre: number, vatOre: number, fc: Fc): FakturaTotals {
  const netOre = amountOre - vatOre;
  return {
    exclVat: fc(netOre),
    vatLabel: isVat25(Math.abs(netOre), Math.abs(vatOre)) ? "Moms (25%)" : "Moms",
    vat: fc(vatOre),
    inclVat: fc(amountOre),
  };
}

/**
 * En nedbrytningsrad som en rad text (fakturasidan): etiketten, och andelen
 * och underlaget när raden har dem — "… (exkl moms) — 20 % av 12 000,00 kr".
 */
export function settlementRowText(r: SettlementRow, fc: Fc): string {
  if (r.shareBips === undefined) return r.label;
  const of = r.basisOre === undefined ? "" : ` av ${fc(r.basisOre)}`;
  return `${r.label} — ${shareLabel(r.shareBips)} %${of}`;
}
