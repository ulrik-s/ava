/**
 * Durabelt, content-adresserat lokalt dokument-lager (ADR 0028 §3, ADR 0023).
 *
 * Läs-sidan av offline-first: när helpern laddat ner ett dokument cachas
 * bytsen durabelt så att SAMMA dokument kan **öppnas igen offline** utan nät.
 * Bytsen lagras under sin egen SHA-256 (content-adresserat → automatisk dedup
 * + integritet: samma version = samma hash = samma fil), och ett index mappar
 * den logiska nyckeln (download-URL:en, som identifierar dokument+version) →
 * hashen. `lastUsedAt` stämplas vid varje store/load och är substratet för
 * 30-dagars-vräkningen (steg 7).
 *
 * Klockan injiceras (`ContentStoreDeps.now`) → deterministiska tester. Filsystem
 * används direkt mot lager-katalogen.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { log } from "./log.ts";

/** En indexpost: vilken blob en logisk nyckel pekar på + metadata. */
export interface ContentIndexEntry {
  /** SHA-256 (hex) av bytsen = blob-filnamnets stam. */
  hash: string;
  /** Användarsynligt filnamn (för logg/UI). */
  fileName: string;
  /** Antal bytes. */
  size: number;
  /** Senast använd (ms sedan epoch) — driver tids-vräkning (steg 7). */
  lastUsedAt: number;
}

type ContentIndex = Record<string, ContentIndexEntry>;

export interface ContentStoreDeps {
  now: () => number;
}

export const defaultContentStoreDeps: ContentStoreDeps = { now: () => Date.now() };

/** SHA-256 (hex) av bytes. Content-adress-nyckeln. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Content-adresserat dokument-lager på disk. Konstruera med lager-katalogen;
 * `store()` efter nedladdning, `load()` vid offline-öppning.
 */
export class ContentStore {
  private readonly dir: string;
  private readonly deps: ContentStoreDeps;
  private index: ContentIndex | undefined;

  constructor(dir: string, deps: ContentStoreDeps = defaultContentStoreDeps) {
    this.dir = dir;
    this.deps = deps;
  }

  private indexPath(): string {
    return join(this.dir, "index.json");
  }

  private blobPath(hash: string): string {
    return join(this.dir, "blobs", `${hash}.bin`);
  }

  /** Läs in (eller initiera) indexet — lat, en gång. */
  private async ensureIndex(): Promise<ContentIndex> {
    if (this.index !== undefined) return this.index;
    try {
      this.index = JSON.parse(await readFile(this.indexPath(), "utf8")) as ContentIndex;
    } catch {
      this.index = {};
    }
    return this.index;
  }

  private async persistIndex(index: ContentIndex): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.indexPath(), JSON.stringify(index), "utf8");
  }

  /**
   * Cacha bytes durabelt under sin hash och peka nyckeln dit. Skriver inte om
   * en blob som redan finns (dedup). Returnerar hashen.
   */
  async store(key: string, bytes: Uint8Array, fileName: string): Promise<string> {
    const index = await this.ensureIndex();
    const hash = sha256Hex(bytes);
    const path = this.blobPath(hash);
    if (!(await Bun.file(path).exists())) {
      await mkdir(join(this.dir, "blobs"), { recursive: true });
      await writeFile(path, bytes);
    }
    index[key] = { hash, fileName, size: bytes.byteLength, lastUsedAt: this.deps.now() };
    await this.persistIndex(index);
    log(`content: cachade ${fileName} (${bytes.byteLength} B, ${hash.slice(0, 8)})`);
    return hash;
  }

  /**
   * Hämta cachade bytes för en nyckel, eller null om de saknas. Bumpar
   * `lastUsedAt`. Städar bort en index-post vars blob försvunnit.
   */
  async load(key: string): Promise<Uint8Array | null> {
    const index = await this.ensureIndex();
    const entry = index[key];
    if (entry === undefined) return null;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(this.blobPath(entry.hash));
    } catch {
      delete index[key]; // blob borta (t.ex. vräkt) → städa indexet
      await this.persistIndex(index);
      return null;
    }
    entry.lastUsedAt = this.deps.now();
    await this.persistIndex(index);
    return bytes;
  }

  /** Finns bytes cachade för nyckeln (utan att läsa dem)? */
  async has(key: string): Promise<boolean> {
    const index = await this.ensureIndex();
    return index[key] !== undefined;
  }

  /**
   * Vräk poster som inte använts på `maxAgeMs` (ADR 0028 §7, default-driver
   * wiras i steg 7). Tar bort en blob bara när ingen kvarvarande nyckel
   * pekar på den (content-adresserat → delad). Returnerar antal vräkta nycklar.
   */
  async evictUnusedOlderThan(maxAgeMs: number): Promise<number> {
    const index = await this.ensureIndex();
    const cutoff = this.deps.now() - maxAgeMs;
    const stale = Object.entries(index).filter(([, e]) => e.lastUsedAt < cutoff);
    for (const [key, entry] of stale) {
      delete index[key];
      if (!Object.values(index).some((e) => e.hash === entry.hash)) {
        await rm(this.blobPath(entry.hash), { force: true });
      }
    }
    if (stale.length > 0) {
      await this.persistIndex(index);
      log(`content: vräkte ${stale.length} oanvänd(a) post(er)`);
    }
    return stale.length;
  }
}
