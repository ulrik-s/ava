/**
 * Diagnostik-invarianter — rena, sidoeffektsfria konsistenskontroller över
 * domändata. En invariant tittar på en uppsättning rader och returnerar noll
 * eller flera {@link InvariantViolation} när datat är internt inkonsistent.
 *
 * Tanken: fel ska *självupptäckas* så fort datat är inläst, inte upptäckas
 * först när en användare snubblar på dem. Klienten kör invarianterna efter
 * hydrering/mutation och matar resultatet till issue-storen ([[issue-store]]),
 * som driver "Rapportera fel"-UI:t.
 *
 * Modulen är medvetet fri från React, DOM och I/O så den kan köras både i
 * webbläsaren och i node-tester (och i framtiden server-side).
 */

import { KOSTNADSRAKNING_DOCUMENT_TYPE } from "@/lib/shared/schemas/document";

/** Maskinläsbar kod per invariant — stabil, används för dedup + filtrering. */
export type InvariantCode = "KR_PENDING_NO_DOC";

export interface InvariantViolation {
  /** Stabil kod för dedup/gruppering. */
  code: InvariantCode;
  severity: "error" | "warning";
  /** Människoläsbar (svensk) beskrivning av felet. */
  message: string;
  /** Strukturerad kontext (ids etc) — bifogas felrapporten. */
  context: Record<string, string>;
}

/** Minimal vy av en BillingRun som invarianten behöver. */
export interface BillingRunView {
  id: string;
  type: string;
  status: string;
}

/** Minimal vy av ett dokument som invarianten behöver. */
export interface DocumentView {
  documentType?: string | null;
}

export interface MatterInvariantInput {
  matterId: string;
  /** Ärendenummer för läsbara meddelanden (valfritt). */
  matterNumber?: string;
  billingRuns: ReadonlyArray<BillingRunView>;
  documents: ReadonlyArray<DocumentView>;
}

const KR_TYPE = "KOSTNADSRAKNING";
const PENDING_VERDICT = "PENDING_VERDICT";

/**
 * Invariant: en kostnadsräkning som väntar på dom MÅSTE ha ett motsvarande
 * Kostnadsräkning-dokument i ärendets fil-lista. Saknas dokumentet har något
 * gått fel i genereringsflödet (t.ex. document-create lyckades inte men
 * billing-run:en skapades) → flagga som error.
 *
 * Vi kollar förekomst av MINST ETT KR-dokument i ärendet, inte 1:1-koppling
 * per run — kopplingen run→dokument är idag lös (matchas på createdAt), så
 * "noll KR-dokument trots pending KR-run" är det robusta, falsk-positiv-fria
 * felet att larma på.
 */
function checkKostnadsrakningHasDocument(input: MatterInvariantInput): InvariantViolation[] {
  const pendingRuns = input.billingRuns.filter(
    (r) => r.type === KR_TYPE && r.status === PENDING_VERDICT,
  );
  if (pendingRuns.length === 0) return [];

  const hasKrDoc = input.documents.some(
    (d) => d.documentType === KOSTNADSRAKNING_DOCUMENT_TYPE,
  );
  if (hasKrDoc) return [];

  const label = input.matterNumber ? `ärende ${input.matterNumber}` : `ärende ${input.matterId}`;
  return pendingRuns.map((run) => ({
    code: "KR_PENDING_NO_DOC" as const,
    severity: "error" as const,
    message:
      `Kostnadsräkning väntar på dom i ${label} men det finns inget ` +
      `Kostnadsräkning-dokument i ärendets fil-lista. Dokumentet kan ha ` +
      `misslyckats att sparas vid genereringen.`,
    context: {
      matterId: input.matterId,
      billingRunId: run.id,
      ...(input.matterNumber ? { matterNumber: input.matterNumber } : {}),
    },
  }));
}

/** Alla per-ärende-invarianter, körda i ordning. Lägg till fler här. */
const MATTER_INVARIANTS: ReadonlyArray<(input: MatterInvariantInput) => InvariantViolation[]> = [
  checkKostnadsrakningHasDocument,
];

/**
 * Kör samtliga per-ärende-invarianter och returnera alla överträdelser.
 * Ren funktion — anroparen ansvarar för rapportering/loggning.
 */
export function detectMatterInvariants(input: MatterInvariantInput): InvariantViolation[] {
  return MATTER_INVARIANTS.flatMap((check) => check(input));
}
