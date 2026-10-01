"use client";

/**
 * Dokumenttext på enheten (#1244) — det den lokala sökningen söker i offline.
 *
 * Serverns fulltext (`document_pages`) går inte att nå offline. Texten
 * extraheras i stället ur de dokument som redan ligger i byte-cachen (juristens
 * aktiva ärenden och dokument som öppnats) och sparas i IndexedDB, så att den
 * finns kvar efter en omladdning. Ett index håller reda på vilka dokument som
 * har text, hur stor den är och när den senast användes.
 *
 * Texten är byråns data (#1347): databasen är den inloggades egen, den rensas
 * vid utloggning, text för ett borttaget dokument glöms vid nästa synk, och
 * den totala storleken hålls under en budget (`DOC_TEXT_BUDGET_BYTES`) — den
 * text som använts längst sedan går först (LRU).
 */

import { z } from "zod";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { LOCAL_DB, localDbName } from "./local-data/local-namespace";

const STORE = "kv";
const INDEX_KEY = "__index__";
const TEXT_PREFIX = "text:";
const textKey = (documentId: string): string => `${TEXT_PREFIX}${documentId}`;

/**
 * Hur mycket text enheten sparar: 50 MB (räknat som UTF-16, två byte per
 * tecken). Det räcker till flera tusen dokument i de aktiva ärendena (en
 * typisk inlaga är 10–50 kB text) men låter aldrig textcachen växa obegränsat.
 */
export const DOC_TEXT_BUDGET_BYTES = 50 * 1024 * 1024;

const indexEntrySchema = z.object({ id: z.string(), bytes: z.number().nonnegative(), usedAt: z.number() }).strict();
/** Indexet; före #1347 bara en lista med id:n. */
const storedIndexSchema = z.array(z.union([indexEntrySchema, z.string()])).catch([]);

type IndexEntry = z.infer<typeof indexEntrySchema>;

/** Textens storlek i byte (UTF-16). */
export function textBytes(text: string): number {
  return text.length * 2;
}

/** Behåll de senast använda posterna inom budgeten; returnerar de som ska bort. */
export function overBudget(entries: readonly IndexEntry[], budgetBytes: number): IndexEntry[] {
  const newestFirst = [...entries].sort((a, b) => b.usedAt - a.usedAt);
  let total = 0;
  return newestFirst.filter((e) => {
    total += e.bytes;
    return total > budgetBytes;
  });
}

export interface LocalDocumentTextOptions {
  /** Databasens namn. Default: den inloggades egen (#1347). */
  dbName?: string;
  budgetBytes?: number;
  now?: () => number;
}

export class LocalDocumentTextStore {
  private readonly kv: IdbKv;
  private readonly budgetBytes: number;
  private readonly now: () => number;

  constructor(factory: IDBFactory = globalThis.indexedDB, opts: LocalDocumentTextOptions = {}) {
    this.kv = new IdbKv(factory, opts.dbName ?? localDbName(LOCAL_DB.docText), STORE);
    this.budgetBytes = opts.budgetBytes ?? DOC_TEXT_BUDGET_BYTES;
    this.now = opts.now ?? Date.now;
  }

  /** Har dokumentet redan sin text här? Då behöver den inte extraheras igen. */
  async has(documentId: string): Promise<boolean> {
    return (await this.index()).some((e) => e.id === documentId);
  }

  /** Spara texten. En text större än hela budgeten sparas inte. */
  async put(documentId: string, text: string): Promise<void> {
    const bytes = textBytes(text);
    if (bytes > this.budgetBytes) return;
    await this.kv.put(textKey(documentId), text);
    const others = (await this.index()).filter((e) => e.id !== documentId);
    await this.saveWithin([...others, { id: documentId, bytes, usedAt: this.now() }]);
  }

  /** All sparad text, för att fylla den lokala sökningen vid start. */
  async loadAll(): Promise<Array<[string, string]>> {
    const out: Array<[string, string]> = [];
    for (const { id } of await this.index()) {
      const text = await this.kv.get<string>(textKey(id));
      if (text) out.push([id, text]);
    }
    return out;
  }

  /**
   * Efter en synk (#1347): glöm texten för dokument som inte längre finns
   * (`existing`), markera dem i `used` som använda nu, och håll budgeten.
   * Text som inget index pekar på (en annan flik skrev indexet samtidigt) tas
   * också bort.
   */
  async reconcile(existing: ReadonlySet<string>, used: ReadonlySet<string>): Promise<void> {
    const now = this.now();
    const kept = (await this.index())
      .filter((e) => existing.has(e.id))
      .map((e) => (used.has(e.id) ? { ...e, usedAt: now } : e));
    const index = await this.saveWithin(kept);
    const indexed = new Set(index.map((e) => textKey(e.id)));
    for (const key of await this.kv.keys()) {
      if (key.startsWith(TEXT_PREFIX) && !indexed.has(key)) await this.kv.delete(key);
    }
  }

  /** Spara indexet inom budgeten (det äldsta går först); returnerar det sparade. */
  private async saveWithin(entries: readonly IndexEntry[]): Promise<IndexEntry[]> {
    const evicted = new Set(overBudget(entries, this.budgetBytes).map((e) => e.id));
    for (const id of evicted) await this.kv.delete(textKey(id));
    const index = entries.filter((e) => !evicted.has(e.id));
    await this.kv.put(INDEX_KEY, index);
    return index;
  }

  /** Indexet; en post från före #1347 (bara id) får sin storlek ur texten. */
  private async index(): Promise<IndexEntry[]> {
    const stored = storedIndexSchema.parse(await this.kv.get<unknown>(INDEX_KEY));
    const out: IndexEntry[] = [];
    for (const e of stored) out.push(typeof e === "string" ? await this.legacyEntry(e) : e);
    return out;
  }

  private async legacyEntry(id: string): Promise<IndexEntry> {
    return { id, bytes: textBytes((await this.kv.get<string>(textKey(id))) ?? ""), usedAt: 0 };
  }
}
