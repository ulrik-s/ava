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

import { z } from "zod";

/** KR-statusarna som zod-enum (en sanningskälla, används av billing-schemat). */
export const kostnadsrakningStatusSchema = z.enum(["INSKICKAD", "BESLUTAD", "OVERKLAGAD", "FAKTURERAD"]);
export type KostnadsrakningStatus = z.infer<typeof kostnadsrakningStatusSchema>;

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

export const KOSTNADSRAKNING_STATUS_LABELS: Record<KostnadsrakningStatus, string> = {
  INSKICKAD: "Inskickad — väntar på beslut",
  BESLUTAD: "Beslutad",
  OVERKLAGAD: "Överklagad — väntar på hovrätten",
  FAKTURERAD: "Fakturerad",
};

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


// ─── Tillstånd ur en lagrad run (#1100) ─────────────────────────────────────
//
// `applyKrAction` ovan äger övergångarna; de här två läser ut nuvarande
// tillstånd ur en persisterad rad och applicerar en övergång. Ren avbildning —
// de låg i routern bara för att det var där raden hämtades.

/** KR-tillstånd ur en körning (#828); saknad status → INSKICKAD (äldre KR). */
export function krStateOf(run: { kostnadsrakningStatus?: KostnadsrakningStatus | null | undefined; beslutSlutgiltigt?: boolean | null | undefined }): KostnadsrakningState {
  return { status: run.kostnadsrakningStatus ?? "INSKICKAD", slutgiltigt: run.beslutSlutgiltigt ?? false };
}

/** Det `canVoidKostnadsrakning` behöver ur en lagrad körning. */
export interface VoidableKostnadsrakning {
  status?: string | null | undefined;
  kostnadsrakningStatus?: string | null | undefined;
  awardedOre?: number | null | undefined;
  invoiceId?: string | null | undefined;
}

/**
 * Får kostnadsräkningen ångras (#1121)? Bara så länge domstolen inte beslutat:
 * inget dömt belopp och ingen faktura. Därefter finns prutning, fakturor och
 * verifikat som bygger på den — då är det ett överklagande, inte ett ångra.
 */
export function canVoidKostnadsrakning(run: VoidableKostnadsrakning): boolean {
  return run.status !== "VOIDED"
    && run.kostnadsrakningStatus === "INSKICKAD"
    && run.awardedOre == null
    && run.invoiceId == null;
}
