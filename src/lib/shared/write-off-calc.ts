/**
 * Ren kundfordrings-matematik för en faktura ([ADR 0007]). Inga DB-anrop —
 * allt testbart utan mockning. Alla belopp i öre (Int).
 *
 * **Partition-invarianten** (varje faktura-krona ligger i exakt en hink):
 *
 *   amount = Σ Payment + Σ Credit(abs) + Σ WriteOff + Utestående
 *
 * `WriteOff` = konstaterad kundförlust (egen daterad post, #136). `outstanding`
 * är resten (`amount − paid − credited − writtenOff`) — definieras som hinken
 * som tar upp slacket, så ekvationen håller per konstruktion. De *meningsfulla*
 * felen är negativa hinkar och översummering (outstanding < 0), som
 * {@link invoicePartitionViolation} fångar.
 *
 * Status **härleds** ur ledgern — sätts inte manuellt ([ADR 0007]).
 *
 * Konsumeras av mutation-vakten (#138) och rapportvyerna (#140).
 *
 * [ADR 0007]: ../../../docs/adr/0007-kundfordringar-konstaterad-kundforlust.md
 */

import type { InvoiceStatus } from "@/lib/shared/schemas/enums";

export interface InvoiceLedger {
  /** Summa registrerade inbetalningar (öre, ≥ 0). */
  paid: number;
  /** Summa krediteringar/nedsättningar (öre, absolutbelopp, ≥ 0). */
  credited: number;
  /** Summa konstaterad kundförlust (öre, ≥ 0). */
  writtenOff: number;
  /** Återstår att driva in: `amount − paid − credited − writtenOff`. */
  outstanding: number;
}

/**
 * Bygg fakturans ledger ur de tre avräknings-hinkarna. `outstanding` är resten.
 * Negativ `outstanding` (översummering) klampas INTE — det är ett invariant-brott
 * som {@link invoicePartitionViolation} ska larma på, inte dölja.
 */
export function computeInvoiceLedger(
  amount: number,
  paid: number,
  credited: number,
  writtenOff: number,
): InvoiceLedger {
  return { paid, credited, writtenOff, outstanding: amount - paid - credited - writtenOff };
}

/**
 * Härled fakturans effektiva status ur ledgern.
 *
 * - `DRAFT`/`CANCELLED` är livscykel-tillstånd som inte följer av ledgern → behålls.
 * - Konstaterad kundförlust vinner: skrevs något av OCH inget återstår → `BAD_DEBT`.
 * - Inget återstår (fullt betald/krediterad) → `PAID`.
 * - Annars behåll inbetalnings-/plan-tillståndet (`SENT`/`INSTALLMENT_PLAN`).
 */
export function deriveInvoiceStatus(stored: InvoiceStatus, ledger: InvoiceLedger): InvoiceStatus {
  if (stored === "DRAFT" || stored === "CANCELLED") return stored;
  if (ledger.writtenOff > 0 && ledger.outstanding <= 0) return "BAD_DEBT";
  if (ledger.outstanding <= 0) return "PAID";
  return stored;
}

/**
 * Verifiera partition-invarianten. Returnerar ett människoläsbart felmeddelande
 * vid brott, annars `null`.
 *
 *   - någon hink negativ (paid/credited/writtenOff)
 *   - översummering: paid + credited + writtenOff > amount  (outstanding < 0)
 *   - partition bruten: hinkarna summerar inte till amount (skyddar mot en
 *     handhopsatt ledger där outstanding inte är resten)
 */
export function invoicePartitionViolation(amount: number, ledger: InvoiceLedger): string | null {
  const { paid, credited, writtenOff, outstanding } = ledger;
  if (paid < 0 || credited < 0 || writtenOff < 0) {
    return `Negativ avräkningshink (betalt=${paid}, krediterat=${credited}, avskrivet=${writtenOff}).`;
  }
  if (outstanding < 0) {
    return `Översummerat: betalt+krediterat+avskrivet (${paid + credited + writtenOff}) överstiger ` +
      `fakturabeloppet (${amount}) med ${-outstanding} öre.`;
  }
  if (paid + credited + writtenOff + outstanding !== amount) {
    return `Partition bruten: ${paid}+${credited}+${writtenOff}+${outstanding} ≠ ${amount}.`;
  }
  return null;
}
