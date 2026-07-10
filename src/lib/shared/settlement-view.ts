/**
 * `SettlementView` (#876) — den persisterade slutregleringsvyn. EN källa för
 * BÅDE faktura-dokumentet (generateFakturaFromTemplate) och Slutfaktura-sidan
 * (`/invoices/[id]`), så de aldrig glider isär. Byggs server-side i settleCoverage
 * ur `SettlementBreakdown` och sparas på respektive faktura (`settlementBreakdown`
 * jsonb). Rena display-siffror i öre — ändrar inga belopp.
 */

/** `add` = delbelopp/steg i trappan, `deduct` = avgår (−), `info` = spårbarhets-
 *  rad utan beloppspåverkan (visas i parentes/grått, t.ex. rådgivnings-omnämnandet). */
export type SettlementRowKind = "add" | "deduct" | "info";

export interface SettlementRow {
  label: string;
  amountOre: number;
  kind: SettlementRowKind;
}

/** En rad i tidsspecifikations-tabellen (arbetad tid). */
export interface SettlementViewLine {
  date: string;
  description: string;
  minutes: number;
  amountOre: number;
}

export interface SettlementView {
  /** Tidsspec-tabellen (arbetad tid). Tom → ingen tabell renderas. */
  timeLines: SettlementViewLine[];
  /** Nedbrytningsraderna (beloppstrappan). */
  rows: SettlementRow[];
  /** Etikett på total-raden ("Att betala (inkl moms)" / "DOMSTOL — att betala …"). */
  totalLabel: string;
  totalOre: number;
}
