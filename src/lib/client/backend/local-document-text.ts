"use client";

/**
 * Dokumenttext på enheten (#1244) — det den lokala sökningen söker i offline.
 *
 * Serverns fulltext (`document_pages`) går inte att nå offline. Texten
 * extraheras i stället ur de dokument som redan ligger i byte-cachen (juristens
 * aktiva ärenden och dokument som öppnats) och sparas i IndexedDB, så att den
 * finns kvar efter en omladdning. Ett index håller reda på vilka dokument som
 * har text — `IdbKv` kan inte lista sina nycklar.
 */

import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";

const DB_NAME = "ava-doc-text";
const STORE = "kv";
const INDEX_KEY = "__index__";
const textKey = (documentId: string): string => `text:${documentId}`;

export class LocalDocumentTextStore {
  private readonly kv: IdbKv;

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.kv = new IdbKv(factory, DB_NAME, STORE);
  }

  private async index(): Promise<string[]> {
    return (await this.kv.get<string[]>(INDEX_KEY)) ?? [];
  }

  /** Har dokumentet redan sin text här? Då behöver den inte extraheras igen. */
  async has(documentId: string): Promise<boolean> {
    return (await this.index()).includes(documentId);
  }

  async put(documentId: string, text: string): Promise<void> {
    await this.kv.put(textKey(documentId), text);
    const ids = await this.index();
    if (!ids.includes(documentId)) await this.kv.put(INDEX_KEY, [...ids, documentId]);
  }

  /** All sparad text, för att fylla den lokala sökningen vid start. */
  async loadAll(): Promise<Array<[string, string]>> {
    const out: Array<[string, string]> = [];
    for (const id of await this.index()) {
      const text = await this.kv.get<string>(textKey(id));
      if (text) out.push([id, text]);
    }
    return out;
  }
}
