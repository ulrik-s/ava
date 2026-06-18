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

const DB_NAME = "ava-doc-content";
const STORE = "kv";
const PENDING_KEY = "__pending__";
const blobKey = (sha: string): string => `blob:${sha}`;

type PendingMap = Record<string, string>; // documentId → sha

export class DocumentContentCache {
  private readonly kv: IdbKv;

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.kv = new IdbKv(factory, DB_NAME, STORE);
  }

  /** Cacha bytes (by sha) + markera dokumentet som väntande på upload. */
  async cache(documentId: string, sha: string, bytes: Uint8Array): Promise<void> {
    await this.kv.put(blobKey(sha), bytes);
    const pending = (await this.kv.get<PendingMap>(PENDING_KEY)) ?? {};
    pending[documentId] = sha; // coalesce: senaste sha per dokument
    await this.kv.put(PENDING_KEY, pending);
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
  async pendingUploads(): Promise<Array<{ documentId: string; sha: string }>> {
    const pending = (await this.kv.get<PendingMap>(PENDING_KEY)) ?? {};
    return Object.entries(pending).map(([documentId, sha]) => ({ documentId, sha }));
  }

  /** Ta bort dokumentet ur pending-manifestet (blobben behålls i läs-cachen). */
  async markUploaded(documentId: string): Promise<void> {
    const pending = (await this.kv.get<PendingMap>(PENDING_KEY)) ?? {};
    delete pending[documentId];
    await this.kv.put(PENDING_KEY, pending);
  }
}
