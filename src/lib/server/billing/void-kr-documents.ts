/**
 * Ångrad kostnadsräkning tar bort sitt dokument (#1230).
 *
 * Körs INNE i `voidKostnadsrakning`-transaktionen. Dokument länkade till
 * körningen (`billingRunId`) tas bort; äldre olänkade KR-dokument bara om
 * exakt ett är entydigt körningens (`selectKrDocsForRun`) — annars ligger det
 * kvar och anteckningen säger det. Borttagningen går samma väg som användarens
 * "Ta bort" (`removeDocument`).
 */

import type { KrVoidedDocOutcome } from "@/lib/shared/billing-notes";
import { selectKrDocsForRun, type KrRunLike } from "@/lib/shared/kr-document";
import type { MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import { removeDocument } from "../documents/remove-document";
import type { ISearchIndex } from "../ports";
import type { Repositories } from "../repositories/repositories";

/** Körningen som ångras (ur `assertKostnadsrakning`). */
export interface VoidedKrRun extends KrRunLike {
  matterId: MatterId;
}

export async function removeVoidedKrDocuments(
  tx: Pick<Repositories, "documents" | "billingRuns">,
  searchIndex: Pick<ISearchIndex, "remove">,
  orgId: OrganizationId,
  run: VoidedKrRun,
): Promise<KrVoidedDocOutcome> {
  const [docs, runs] = await Promise.all([
    tx.documents.listByMatter(run.matterId),
    tx.billingRuns.listForOrg(orgId, run.matterId),
  ]);
  const krRuns = runs.filter((r) => r.type === "KOSTNADSRAKNING");
  const selection = selectKrDocsForRun(docs, run, krRuns);
  if (selection.kind === "ambiguous") return { kind: "kept" };
  if (selection.kind === "none") return { kind: "none" };
  for (const doc of selection.docs) await removeDocument(tx, searchIndex, doc.id);
  return { kind: "removed", fileNames: selection.docs.map((d) => d.fileName) };
}
