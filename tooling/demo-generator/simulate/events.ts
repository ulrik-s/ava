/**
 * Händelse-modell för den kronologiska demo-simuleringen (#880). Varje `SimEvent`
 * motsvarar en "user action" som spelas upp via tRPC med eventets datum. Belopp som
 * beror på ackumulerat arbete (aconto, slutreglering) HÄRLEDS i runnern, inte här.
 */

import type { MatterRole } from "@/lib/shared/schemas/enums";

export type SimEvent =
  /** Länka en part (motpart/ombud/domstol) till ärendet — matter.addContact. */
  | { kind: "party"; dayOffset: number; contactId: string; role: MatterRole }
  /** Debiterbar (eller ej) tidspost — timeEntry.create. `entryKind` = ARBETE (default)
   *  eller TIDSSPILLAN (#891, egen norm vid rättshjälps-slutreglering). */
  | { kind: "time"; dayOffset: number; minutes: number; description: string; billable?: boolean; entryKind?: "ARBETE" | "TIDSSPILLAN" }
  /** Tjänsteanteckning (händelselogg) — serviceNote.create. */
  | { kind: "note"; dayOffset: number; text: string }
  /** Utlägg — expense.create. */
  | { kind: "expense"; dayOffset: number; amountOre: number; description: string; vatRate?: number }
  /** Dokument (in/ut) ur DOC_TEMPLATES — document.register + bytes via sink. */
  | { kind: "doc"; dayOffset: number; template: string }
  /** Rådgivningstimmen faktureras — invoice.createRadgivning. */
  | { kind: "radgivning"; dayOffset: number }
  /** Aconto på klientens andel vid `clientShareBips` (belopp härlett) — createAcconto.
   *  FAST aconto (rättsskydd-självrisk); rättshjälp använder `rateChange` + tröskel. */
  | { kind: "acconto"; dayOffset: number; clientShareBips: number }
  /** Ändra klientens självrisk-sats (bips) från denna dag (#885). Rättshjälp: satsen
   *  varierar över tid; aconto skickas när klientens ackumulerade andel når tröskeln. */
  | { kind: "rateChange"; dayOffset: number; clientShareBips: number }
  /** Kostnadsräkning till domstol — createKostnadsrakning. */
  | { kind: "kostnadsrakning"; dayOffset: number }
  /** Domstolens beslut på KR:n — recordKostnadsrakningBeslut. */
  | { kind: "beslut"; dayOffset: number }
  /** Skapa domstolsfakturan EFTER beslut (offentligt uppdrag) — setVerdict. */
  | { kind: "verdict"; dayOffset: number }
  /** Slutreglering (rättshjälp/-skydd) — settleCoverage (→ klient FINAL/CREDIT + betalare). */
  | { kind: "settle"; dayOffset: number; payerRecipient: string }
  /** Vanlig slutfaktura (privat/offentligt) — createFinal + SENT. */
  | { kind: "final"; dayOffset: number; recipient: string }
  /** Betala den senast skapade slutfakturan — invoice.recordPayment. */
  | { kind: "payment"; dayOffset: number };

/** Det runnern behöver veta om ärendet för att spela upp dess scenario. */
export interface SimMatter {
  /** Översatt (UUID) ärende-id. */
  id: string;
  /** Ärendenummer (t.ex. "2026-0020") — dispatchern väljer scenariovariant på det. */
  matterNumber?: string;
  paymentMethod: string;
  clientShareBips?: number | null;
  /** Ansvarig jurist (userId) — sätts som tidsposternas användare. */
  lawyerId: string;
  /** Ärendets startålder i dagar (seedens createdDaysAgo). */
  startDaysAgo: number;
  /** Arvode-sats (öre/tim) som ackumulerat arbete värderas på — driver aconto-belopp
   *  (rättshjälp: timkostnadsnormen; annars ansvarig jurists timtaxa). */
  arvodeRateOre: number;
}

/** Parter att länka in via `party`-events (översatta UUID:n) — ur seedens
 *  matterContacts, så klient/motpart/ombud/domstol får riktiga kontakter. */
export interface Parties {
  klient?: string | undefined;
  motpart?: string | undefined;
  motpartsombud?: string | undefined;
  domstol?: string | undefined;
}
