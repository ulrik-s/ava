/**
 * Faktureringsflöden per ärendetyp (#816/#817) — EN deklarativ sanningskälla för
 * vad som får faktureras NÄR, per `paymentMethod`. Driver både UI-panelen
 * (tillgängliga actions + dom-banner + vilken dialog en knapp öppnar) och
 * server-guards (att en action är laglig i ärendets nuvarande fas). Ren logik,
 * inga I/O — delas av server, klient och tester.
 *
 * Designval (2026-06): **härledd fas** (stateless, ur billing-runs + matter —
 * ingen kolumn, ingen osynk), **in-kod-descriptors** (ändlig enum av flöden,
 * ingen runtime/DB-konfiguration), **minimal MIX/PENDING**. Speglar mönstret i
 * {@link file://./invoice-state-machine.ts} (deklarativ map + assert).
 *
 * Statemaskinen: `actionsByPhase[fas]` = de actions som är lagliga i fasen, och
 * varje action:s `toPhase` är kanten till nästa fas. Faserna härleds av
 * {@link currentPhase}; terminala faser (SLUTREGLERAD/NEKAD) har tomma action-
 * listor men finns som nycklar så flödet "äger" fasen.
 */

import type { BillingRunRecipient, BillingRunStatus, BillingRunType, PaymentMethod } from "./schemas/enums";

/** Ärendets faktureringsfas (härledd, ej lagrad). */
export type BillingPhase = "ARBETE" | "VANTAR_DOM" | "SLUTREGLERAD" | "NEKAD";

/** UI-action i fakturapanelen (≠ BillingRunType — SETTLE är ingen run-typ). */
export type BillingActionType = "ACCONTO" | "FINAL" | "KOSTNADSRAKNING" | "SETTLE";

/** Vilken dialog en action/dom-knapp öppnar i panelen. */
export type BillingDialog = "billing" | "settlement" | "kostnadsrakning" | "verdict";

export interface BillingAction {
  type: BillingActionType;
  label: string;
  /** Fasen ärendet hamnar i när action:en utförs (statemaskinens kant). */
  toPhase: BillingPhase;
  /** Mottagare för den faktura/körning som skapas (utelämnad för ACCONTO=KLIENT). */
  recipient?: BillingRunRecipient;
  dialog: BillingDialog;
}

/** "Väntar på dom"-bannern: när ärendet är i `phase`, vad domsknappen öppnar. */
export interface PendingBanner {
  phase: BillingPhase;
  dialog: Extract<BillingDialog, "settlement" | "verdict">;
  label: string;
}

export interface BillingFlow {
  initialPhase: BillingPhase;
  /** Lagliga actions per fas. Nycklarna = de faser flödet äger. */
  actionsByPhase: Partial<Record<BillingPhase, readonly BillingAction[]>>;
  pendingBanner?: PendingBanner;
}

const aconto = (): BillingAction => ({ type: "ACCONTO", label: "Aconto till klient", toPhase: "ARBETE", recipient: "KLIENT", dialog: "billing" });

/** PRIVAT/MIX: löpande FINAL till klienten, ingen besluts-/domslivscykel. */
const PRIVAT_FLOW: BillingFlow = {
  initialPhase: "ARBETE",
  actionsByPhase: {
    ARBETE: [{ type: "FINAL", label: "Faktura till klient", toPhase: "ARBETE", recipient: "KLIENT", dialog: "billing" }],
  },
};

export const BILLING_FLOWS: Record<PaymentMethod, BillingFlow> = {
  // Betalningssätt ej fastställt → inga faktureringsåtgärder ännu.
  PENDING: { initialPhase: "ARBETE", actionsByPhase: { ARBETE: [] } },
  PRIVAT: PRIVAT_FLOW,
  MIX: PRIVAT_FLOW,
  // Rättsskydd: aconto under väntan, sedan slutreglering på försäkringsbeskedet
  // (eller direktfaktura till bolaget). Nekat → NEKAD (banner föreslår rättshjälp).
  RATTSSKYDD: {
    initialPhase: "ARBETE",
    actionsByPhase: {
      ARBETE: [
        aconto(),
        { type: "FINAL", label: "Faktura till försäkring", toPhase: "SLUTREGLERAD", recipient: "FORSAKRING", dialog: "billing" },
        { type: "SETTLE", label: "Slutreglera (försäkringsbesked)", toPhase: "SLUTREGLERAD", recipient: "FORSAKRING", dialog: "settlement" },
      ],
      SLUTREGLERAD: [],
      NEKAD: [],
    },
  },
  // Rättshjälp: aconto + kostnadsräkning till domstol (väntar på dom) + slutreglering.
  RATTSHJALP: {
    initialPhase: "ARBETE",
    actionsByPhase: {
      ARBETE: [
        aconto(),
        { type: "KOSTNADSRAKNING", label: "Kostnadsräkning till domstol", toPhase: "VANTAR_DOM", recipient: "DOMSTOL", dialog: "kostnadsrakning" },
        { type: "SETTLE", label: "Slutreglera (dom)", toPhase: "SLUTREGLERAD", recipient: "RATTSHJALPSMYNDIGHET", dialog: "settlement" },
      ],
      VANTAR_DOM: [
        { type: "SETTLE", label: "Slutreglera (dom)", toPhase: "SLUTREGLERAD", recipient: "RATTSHJALPSMYNDIGHET", dialog: "settlement" },
      ],
      SLUTREGLERAD: [],
    },
    pendingBanner: { phase: "VANTAR_DOM", dialog: "settlement", label: "Slutreglera (dom)" },
  },
  // Offentligt uppdrag: kostnadsräkning till domstol → dom (prutning) via verdict.
  OFFENTLIGT_UPPDRAG: {
    initialPhase: "ARBETE",
    actionsByPhase: {
      ARBETE: [
        { type: "KOSTNADSRAKNING", label: "Kostnadsräkning till domstol", toPhase: "VANTAR_DOM", recipient: "DOMSTOL", dialog: "kostnadsrakning" },
      ],
      VANTAR_DOM: [],
      SLUTREGLERAD: [],
    },
    pendingBanner: { phase: "VANTAR_DOM", dialog: "verdict", label: "Ange dom + prutning" },
  },
};

/** Minimal vy av en billing-run för fas-härledningen. */
export interface FlowRun {
  type: BillingRunType;
  status: BillingRunStatus;
}

/** Minimal vy av ärendet för fas-härledningen. */
export interface FlowMatter {
  paymentMethod: PaymentMethod;
  rattsskyddNekadAt?: Date | string | null | undefined;
}

function flowHasPhase(flow: BillingFlow, phase: BillingPhase): boolean {
  return phase in flow.actionsByPhase;
}

function hasPendingVerdict(runs: ReadonlyArray<FlowRun>): boolean {
  return runs.some((r) => r.type === "KOSTNADSRAKNING" && r.status === "PENDING_VERDICT");
}

/** Slutreglerat = en utställd slutfaktura/kostnadsräkning finns (aconto räknas ej). */
function isSettled(runs: ReadonlyArray<FlowRun>): boolean {
  return runs.some((r) => (r.type === "FINAL" || r.type === "KOSTNADSRAKNING") && r.status === "SENT");
}

/**
 * Härleder ärendets faktureringsfas (stateless) ur flödet + matter + runs:
 * NEKAD (avslagsdatum) → VANTAR_DOM (kostnadsräkning väntar) → SLUTREGLERAD
 * (utställd slutfaktura, inget väntar) → annars flödets initialfas (ARBETE).
 * Faser som flödet inte äger hoppas över.
 */
export function currentPhase(matter: FlowMatter, runs: ReadonlyArray<FlowRun>): BillingPhase {
  const flow = BILLING_FLOWS[matter.paymentMethod];
  if (flowHasPhase(flow, "NEKAD") && matter.rattsskyddNekadAt) return "NEKAD";
  if (flowHasPhase(flow, "VANTAR_DOM") && hasPendingVerdict(runs)) return "VANTAR_DOM";
  if (flowHasPhase(flow, "SLUTREGLERAD") && isSettled(runs)) return "SLUTREGLERAD";
  return flow.initialPhase;
}

/** Tillgängliga actions i ärendets nuvarande fas (driver panelmenyn). */
export function availableActions(matter: FlowMatter, runs: ReadonlyArray<FlowRun>): readonly BillingAction[] {
  const flow = BILLING_FLOWS[matter.paymentMethod];
  return flow.actionsByPhase[currentPhase(matter, runs)] ?? [];
}

/** Dom-bannern för ärendet, om flödet har en och ärendet är i dess fas. */
export function pendingBannerFor(matter: FlowMatter, runs: ReadonlyArray<FlowRun>): PendingBanner | null {
  const flow = BILLING_FLOWS[matter.paymentMethod];
  if (flow.pendingBanner && currentPhase(matter, runs) === flow.pendingBanner.phase) return flow.pendingBanner;
  return null;
}

/** Är `action` laglig i `phase` för flödet? (server-guard, fas 3.) */
export function canBillingTransition(method: PaymentMethod, phase: BillingPhase, action: BillingActionType): boolean {
  return (BILLING_FLOWS[method].actionsByPhase[phase] ?? []).some((a) => a.type === action);
}

/**
 * Säkerställer att `action` är laglig i ärendets nuvarande fas; kastar annars
 * (ren Error — serverlagret översätter till TRPCError i fas 3). Används av
 * mutationerna så ett flöde inte kan ta ett otillåtet steg (t.ex. slutreglera
 * ett PRIVAT-ärende eller fakturera ett nekat rättsskydd).
 */
export function assertBillingTransition(matter: FlowMatter, runs: ReadonlyArray<FlowRun>, action: BillingActionType): void {
  const phase = currentPhase(matter, runs);
  if (!canBillingTransition(matter.paymentMethod, phase, action)) {
    throw new Error(`Åtgärden "${action}" är inte tillåten i fasen "${phase}" för ${matter.paymentMethod}.`);
  }
}
