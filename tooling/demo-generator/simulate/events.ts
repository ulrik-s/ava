/**
 * Händelse-modell för den kronologiska demo-simuleringen (#880). Varje `SimEvent`
 * motsvarar en "user action" som spelas upp via tRPC med eventets datum. Belopp som
 * beror på ackumulerat arbete (aconto, slutreglering) HÄRLEDS i runnern, inte här.
 */

import type { MatterRole, TimeEntryKind } from "@/lib/shared/schemas/enums";

export type SimEvent =
  /** Länka en part (motpart/ombud/domstol) till ärendet — matter.addContact. */
  | { kind: "party"; dayOffset: number; contactId: string; role: MatterRole }
  /** Debiterbar (eller ej) tidspost — timeEntry.create. `entryKind` = arvodeskategori
   *  (default ARBETE); varje kategori har en egen årsnorm vid slutregleringen av
   *  rättshjälp/rättsskydd (#950/#953). */
  | { kind: "time"; dayOffset: number; minutes: number; description: string; billable?: boolean; entryKind?: TimeEntryKind }
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
  /**
   * Domstolens beslut på KR:n — recordKostnadsrakningBeslut. Utan `reducedByBips`
   * beviljas hela det yrkade beloppet. Med `reducedByBips` PRUTAR domstolen (1500 =
   * 15 % nedsättning): rättshjälpens prutning bärs av BYRÅN — klientens avgift räknas
   * om på det nedsatta beloppet och mellanskillnaden bokas som en förlust (#936).
   */
  | { kind: "beslut"; dayOffset: number; reducedByBips?: number }
  /** Skapa domstolsfakturan EFTER beslut (offentligt uppdrag) — setVerdict. */
  | { kind: "verdict"; dayOffset: number }
  /** Slutreglering (rättshjälp/-skydd) — settleCoverage (→ klient FINAL/CREDIT + betalare). */
  | { kind: "settle"; dayOffset: number; payerRecipient: string }
  /** Försäkringens prutning EFTER slutreglering (#905/#952, rättsskydd flöde B) —
   *  `prunedNetOre` (netto) omfördelas från försäkringsfakturan till klientfakturan.
   *  Inga nya fakturor: fakturan är ställd till klienten, så bolaget krediteras inte. */
  | { kind: "insurerPruning"; dayOffset: number; prunedNetOre: number }
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
