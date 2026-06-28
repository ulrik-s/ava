/**
 * Kostnadsräkningens livscykel (#828) — domstols-flödet (rättshjälp + offentligt
 * uppdrag) där **Beslut, Faktura och Överklagan är distinkta steg PÅ kostnads-
 * räkningen**. Ren logik, inga I/O — delas av server, klient och tester.
 *
 * Faktura skapas ALDRIG förrän domstolen beslutat beloppet (KR→Beslut→Faktura).
 * Överklagan av prutningen är en inlaga (Word) som mailas in; hovrättens beslut
 * (PDF) är slutgiltigt och kan inte överklagas igen — ingen ny kostnadsräkning.
 *
 * State-maskin:
 *   INSKICKAD  ──registrera beslut──▶ BESLUTAD
 *   BESLUTAD   ──skapa faktura──────▶ FAKTURERAD
 *   BESLUTAD   ──överklaga──────────▶ ÖVERKLAGAD            (endast om ej slutgiltigt)
 *   ÖVERKLAGAD ──hovrättens beslut──▶ BESLUTAD (slutgiltigt → bara faktura kvar)
 *
 * Speglar mönstret i {@link file://./invoice-state-machine.ts}.
 */

export type KostnadsrakningStatus = "INSKICKAD" | "BESLUTAD" | "OVERKLAGAD" | "FAKTURERAD";

export type KostnadsrakningAction =
  | "REGISTRERA_BESLUT"
  | "SKAPA_FAKTURA"
  | "OVERKLAGA"
  | "REGISTRERA_HOVRATT_BESLUT";

/** KR:ns tillstånd: status + om beslutet är slutgiltigt (efter hovrätten). */
export interface KostnadsrakningState {
  status: KostnadsrakningStatus;
  /** Sant efter hovrättens beslut → får ej överklagas igen. */
  slutgiltigt: boolean;
}

// Status-/action-etiketter (UI) introduceras i UI-steget (epic #828, steg 5) när
// de har en konsument — knip-ratchet tillåter inga oanvända exports.

/** Lagliga åtgärder i ett givet KR-tillstånd (state-maskinens kanter). */
export function availableKrActions(state: KostnadsrakningState): readonly KostnadsrakningAction[] {
  switch (state.status) {
    case "INSKICKAD": return ["REGISTRERA_BESLUT"];
    // Slutgiltigt beslut (hovrätten) → bara fakturera; annars även överklaga.
    case "BESLUTAD": return state.slutgiltigt ? ["SKAPA_FAKTURA"] : ["SKAPA_FAKTURA", "OVERKLAGA"];
    case "OVERKLAGAD": return ["REGISTRERA_HOVRATT_BESLUT"];
    case "FAKTURERAD": return [];
  }
}

/** Är `action` laglig i `state`? */
export function canKrAction(state: KostnadsrakningState, action: KostnadsrakningAction): boolean {
  return availableKrActions(state).includes(action);
}

/** Tillämpar en åtgärd och returnerar det nya tillståndet; kastar vid otillåten
 *  övergång (ren Error — serverlagret översätter till TRPCError). */
export function applyKrAction(state: KostnadsrakningState, action: KostnadsrakningAction): KostnadsrakningState {
  if (!canKrAction(state, action)) {
    throw new Error(`Åtgärden "${action}" är inte tillåten i kostnadsräknings-status "${state.status}".`);
  }
  switch (action) {
    case "REGISTRERA_BESLUT": return { status: "BESLUTAD", slutgiltigt: false };
    case "OVERKLAGA": return { status: "OVERKLAGAD", slutgiltigt: false };
    // Hovrättens beslut är slutgiltigt.
    case "REGISTRERA_HOVRATT_BESLUT": return { status: "BESLUTAD", slutgiltigt: true };
    case "SKAPA_FAKTURA": return { status: "FAKTURERAD", slutgiltigt: state.slutgiltigt };
  }
}
