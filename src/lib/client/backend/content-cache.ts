"use client";

/**
 * `DocumentContentCache` (#518, ADR 0023) — klientens byte-cache för
 * dokument-innehåll i IndexedDB (ovanpå `IdbKv`).
 *
 * Två roller:
 *   1. **Immutabel blob-cache** nyckel-ad på sha256 → snabb öppning + offline,
 *      behöver aldrig invalideras (content-adresserat).
 *   2. **Pending-upload-manifest** (`documentId → sha`) som byte-synken läser
 *      vid reconnect. Manifestet är keyat på `documentId` → flera offline-
 *      sparningar av samma dokument **slås samman** till den senaste sha:n
 *      (bara den laddas upp).
 */

import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { asId, type DocumentId } from "@/lib/shared/schemas/ids";
import { LOCAL_DB, localDbName } from "./local-data/local-namespace";

const STORE = "kv";
/** Nyckeln för dokumenten som väntar på uppladdning (`documentId → sha`). */
export const CONTENT_PENDING_KEY = "__pending__";
const BLOB_PREFIX = "blob:";
const blobKey = (sha: string): string => `${BLOB_PREFIX}${sha}`;

type PendingMap = Record<string, string>; // documentId → sha

export class DocumentContentCache {
  private readonly kv: IdbKv;

  /** Databasen är den inloggades egen (#1347), om inget annat namn ges. */
  constructor(factory: IDBFactory = globalThis.indexedDB, dbName: string = localDbName(LOCAL_DB.docContent)) {
    this.kv = new IdbKv(factory, dbName, STORE);
  }

  /** Cacha bytes (by sha) + markera dokumentet som väntande på upload. */
  async cache(documentId: DocumentId, sha: string, bytes: Uint8Array): Promise<void> {
    await this.kv.put(blobKey(sha), bytes);
    const pending = (await this.kv.get<PendingMap>(CONTENT_PENDING_KEY)) ?? {};
    pending[documentId] = sha; // coalesce: senaste sha per dokument
    await this.kv.put(CONTENT_PENDING_KEY, pending);
  }

  /** Cacha bytes utan pending-markering (läs-cache: download→cache vid öppning). */
  async putBytes(sha: string, bytes: Uint8Array): Promise<void> {
    await this.kv.put(blobKey(sha), bytes);
  }

  /** Cachade bytes för en sha, eller null. */
  async getBytes(sha: string): Promise<Uint8Array | null> {
    const v = await this.kv.get<Uint8Array | ArrayBuffer>(blobKey(sha));
    return v ? new Uint8Array(v) : null;
  }

  /** Dokument som väntar på byte-upload ({documentId, sha}). */
  async pendingUploads(): Promise<Array<{ documentId: DocumentId; sha: string }>> {
    const pending = (await this.kv.get<PendingMap>(CONTENT_PENDING_KEY)) ?? {};
    return Object.entries(pending).map(([documentId, sha]) => ({ documentId: asId<"DocumentId">(documentId), sha }));
  }

  /**
   * Töm läs-cachen (#1347, utloggning): bytes som inte väntar på uppladdning
   * tas bort; de som väntar ligger kvar till nästa inloggning. Returnerar
   * antalet dokument som väntar.
   */
  async purgeReadCache(): Promise<number> {
    const pending = await this.pendingUploads();
    const keep = new Set(pending.map((p) => blobKey(p.sha)));
    for (const key of await this.kv.keys()) {
      if (key.startsWith(BLOB_PREFIX) && !keep.has(key)) await this.kv.delete(key);
    }
    return pending.length;
  }

  /** Ta bort dokumentet ur pending-manifestet (blobben behålls i läs-cachen). */
  async markUploaded(documentId: DocumentId): Promise<void> {
    const pending = (await this.kv.get<PendingMap>(CONTENT_PENDING_KEY)) ?? {};
    delete pending[documentId];
    await this.kv.put(CONTENT_PENDING_KEY, pending);
  }
}
