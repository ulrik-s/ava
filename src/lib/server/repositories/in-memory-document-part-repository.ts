/**
 * In-memory `DocumentPartRepository` (#1220) — browser/offline/demo-impl.
 */

import type { DocumentPart } from "@/lib/shared/schemas/document";
import type { DocumentId, MatterId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import { byFromPage, type DocumentPartRepository } from "./document-part-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type DocumentPartRepoSource = Pick<IDataStore, "documentParts">;

/** Delegatens findMany filtrerar inte tombstones — gör det här. */
function live(rows: readonly DocumentPart[]): DocumentPart[] {
  return rows.filter((r) => !r.deletedAt).sort(byFromPage);
}

export class InMemoryDocumentPartRepository
  extends InMemoryRepository<DocumentPart>
  implements DocumentPartRepository {
  constructor(store: DocumentPartRepoSource, now?: () => Date) {
    super(store.documentParts, now ?? (() => new Date()));
  }

  async listForDocument(documentId: DocumentId): Promise<DocumentPart[]> {
    return live((await this.delegate.findMany({ where: { documentId } })) as DocumentPart[]);
  }

  async listByMatter(matterId: MatterId): Promise<DocumentPart[]> {
    return live((await this.delegate.findMany({ where: { matterId } })) as DocumentPart[]);
  }
}
