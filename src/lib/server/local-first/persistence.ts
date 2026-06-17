/**
 * `IPersistence` — abstraktion för persistent storage av MemFs-snapshot:s.
 *
 * Designval (Open-closed + Liskov):
 *   - Smalt interface — bara save/load/clear av en JSON-serialiserbar
 *     `Record<string, string>` (base64-buffrar, en per fil-path).
 *   - Ny backend = ny klass som implementerar interfacet. Inga
 *     ändringar i konsumenterna.
 *
 * Implementationer:
 *   - `InMemoryPersistence`: bara minne. För tester och fallback.
 *   - `IndexedDbFsPersistence` (`indexeddb-fs-persistence.ts`): browser-cachen
 *     (demon, #3). Survivar page-reload, best-effort (no-op om IndexedDB blockerat).
 *
 * (`OpfsPersistence` togs bort i #420 — demon kör på IndexedDB sedan #483 och
 *  ingen kod använde OPFS-backenden längre.)
 */

import { z } from "zod";

// Zod vid parsegränsen (#187): snapshotten läses från cache — validera formen.
export const fsSnapshotSchema = z.record(z.string(), z.string());
export type FsSnapshot = z.infer<typeof fsSnapshotSchema>;

export interface IPersistence {
  /** Returnera tidigare sparad snapshot, eller null om inget finns. */
  load(): Promise<FsSnapshot | null>;
  /** Skriv över persistent state med given snapshot. */
  save(snapshot: FsSnapshot): Promise<void>;
  /** Radera persistent state. */
  clear(): Promise<void>;
}

// ─── InMemoryPersistence ──────────────────────────────────────────

export class InMemoryPersistence implements IPersistence {
  private snapshot: FsSnapshot | null = null;

  async load(): Promise<FsSnapshot | null> {
    return this.snapshot ? { ...this.snapshot } : null;
  }

  async save(snapshot: FsSnapshot): Promise<void> {
    this.snapshot = { ...snapshot };
  }

  async clear(): Promise<void> {
    this.snapshot = null;
  }
}
