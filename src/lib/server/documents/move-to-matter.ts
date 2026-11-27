/**
 * Flytta dokument till ett annat ärende och en mapp där (#2045). Körs i
 * anroparens transaktion och tar repona explicit (förebild `move-entries.ts`).
 *
 * En flytt är metadata (ADR 0023): versionen byts inte, och bytes, sidtext och
 * förslag hänger på dokumentets id och följer med. Delarna speglar dokumentets
 * ärende (`DocumentPartRepository`) och får det nya.
 */
import { TRPCError } from "@trpc/server";
import { documentMoveBlock } from "@/lib/shared/document-move";
import type { Document } from "@/lib/shared/schemas/document";
import type { DocumentFolderId, DocumentId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { DocumentPartRepository } from "../repositories/document-part-repository";
import type { DocumentRepository } from "../repositories/document-repository";

/** Repona flytten läser och skriver. */
export interface MoveDocumentsRepos {
  documents: Pick<DocumentRepository, "getByIdInOrg" | "getById" | "updateMetadata">;
  documentParts: Pick<DocumentPartRepository, "listForDocument" | "update">;
}

/** Var dokumenten hamnar: ärendet och mappen där (`null` = överst, utan mapp). */
export interface DocumentMoveTarget {
  matterId: MatterId;
  folderId: DocumentFolderId | null;
}

/**
 * Dokumenten som ska flyttas, vart och ett i byrån och inte fakturans eller
 * kostnadsräkningens eget — annars vägras hela anropet innan något skrivs.
 */
async function loadMovable(repos: MoveDocumentsRepos, orgId: OrganizationId, ids: DocumentId[]): Promise<Document[]> {
  const docs = await Promise.all(ids.map((id) => loadOne(repos, orgId, id)));
  return docs.map((doc) => {
    const blocked = documentMoveBlock(doc);
    if (blocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: blocked });
    return doc;
  });
}

/** Hela dokumentraden, efter samma byråkontroll som `assertDocAccess`. */
async function loadOne(repos: MoveDocumentsRepos, orgId: OrganizationId, id: DocumentId): Promise<Document> {
  const access = await repos.documents.getByIdInOrg(id, orgId);
  const doc = access ? await repos.documents.getById(id) : null;
  if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
  return doc;
}

/** Dokumentet först och sedan dess delar, så att radkön skickar dem i den ordningen. */
async function moveOne(repos: MoveDocumentsRepos, doc: Document, target: DocumentMoveTarget): Promise<void> {
  await repos.documents.updateMetadata(doc.id, { matterId: target.matterId, folderId: target.folderId });
  if (doc.matterId === target.matterId) return;
  for (const part of await repos.documentParts.listForDocument(doc.id)) {
    await repos.documentParts.update(part.id, { matterId: target.matterId });
  }
}

/**
 * Flyttar dokumenten till `target` (allt eller inget: alla prövas innan något
 * skrivs). Ett dokument som redan ligger i målärendet får bara den nya mappen.
 * Ger antalet flyttade dokument.
 */
export async function moveDocumentsToMatter(
  repos: MoveDocumentsRepos, orgId: OrganizationId, ids: DocumentId[], target: DocumentMoveTarget,
): Promise<number> {
  const docs = await loadMovable(repos, orgId, ids);
  for (const doc of docs) await moveOne(repos, doc, target);
  return docs.length;
}
