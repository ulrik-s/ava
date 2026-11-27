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
import type { BillingRunStatus, BillingRunType } from "../schemas/enums";

/** KR-statusarna som zod-enum (en sanningskälla, används av billing-schemat). */
export const kostnadsrakningStatusSchema = z.enum(["INSKICKAD", "BESLUTAD", "OVERKLAGAD", "FAKTURERAD"]);
export type KostnadsrakningStatus = z.infer<typeof kostnadsrakningStatusSchema>;

/**
 * Kostnadsräkningens livscykel som användaren ser den (#1860), t.ex. i ärendets
 * faktureringslista. Kartan ligger bredvid enumen så att kompilatorn kräver alla
 * statusar (som `VAT_RATE_LABELS` i `vat.ts`).
 */
export const KOSTNADSRAKNING_STATUS_LABELS: Readonly<Record<KostnadsrakningStatus, string>> = {
  INSKICKAD: "Väntar på dom",
  BESLUTAD: "Beslutad",
  OVERKLAGAD: "Överklagad",
  FAKTURERAD: "Fakturerad",
};

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

/** Det livscykeln läser ur en lagrad körning (alla anropare skickar hela rader). */
export interface KrStateSource {
  kostnadsrakningStatus?: KostnadsrakningStatus | null | undefined;
  beslutSlutgiltigt?: boolean | null | undefined;
  /** Körningens allmänna status — läses bara när `kostnadsrakningStatus` saknas. */
  status?: BillingRunStatus | null | undefined;
  /** Fakturan på kostnadsräkningen — läses bara när `kostnadsrakningStatus` saknas. */
  invoiceId?: string | null | undefined;
}

/**
 * Livsstatusen ur en körning (#828, #1859). Ett satt `kostnadsrakningStatus`
 * vinner alltid. En äldre kostnadsräkning utan värde (före migrering 0012) tolkas
 * här och ingen annanstans: har den en faktura eller är den skickad (`SENT`) är
 * den FAKTURERAD, annars INSKICKAD.
 */
function krStatusOf(run: KrStateSource): KostnadsrakningStatus {
  if (run.kostnadsrakningStatus) return run.kostnadsrakningStatus;
  return run.invoiceId != null || run.status === "SENT" ? "FAKTURERAD" : "INSKICKAD";
}

/** KR-tillstånd ur en körning (#828); saknad status tolkas av `krStatusOf`. */
export function krStateOf(run: KrStateSource): KostnadsrakningState {
  return { status: krStatusOf(run), slutgiltigt: run.beslutSlutgiltigt ?? false };
}

/** Det `isActiveKr` läser ur en körning (panelens rader och repo-raderna passar båda). */
export interface ActiveKrSource extends KrStateSource {
  type: BillingRunType;
  status: BillingRunStatus;
}

/**
 * Aktiv kostnadsräkning (#828, #1859): livscykeln är inte klar och den är inte
 * ångrad (#1121). Den enda läsaren av "väntar kostnadsräkningen på domstolen" —
 * fasen, KR-kortet, summeringen och diagnostiken går alla hit.
 */
export function isActiveKr(r: ActiveKrSource): boolean {
  return r.type === "KOSTNADSRAKNING" && r.status !== "VOIDED" && krStateOf(r).status !== "FAKTURERAD";
}

/** Det `canVoidKostnadsrakning` behöver ur en lagrad körning. */
export interface VoidableKostnadsrakning {
  status?: BillingRunStatus | null | undefined;
  kostnadsrakningStatus?: KostnadsrakningStatus | null | undefined;
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
    && krStateOf(run).status === "INSKICKAD"
    && run.awardedOre == null
    && run.invoiceId == null;
}
