/**
 * `CursorStore` (ADR 0017, #414) — persisterar offline-klientens delta-sync-
 * cursor (serverns senaste sedda position) och serverns synkepok (#1360):
 * cursorn gäller bara i den epoken — återställs serverns databas ur en backup
 * byts epoken och klienten synkar om från 0. In-memory för tester/demo,
 * IndexedDB (via `IdbKv`) i browsern.
 *
 * Self-hosted-klienten (#1711) håller flikens position i minnet
 * (`InMemoryCursorStore`) och sparar den i SAMMA transaktion som snapshotet
 * (`IndexedDbPersistence`): positionen på disk hör alltid till snapshotet
 * bredvid, och är aldrig före det.
 */

import { z } from "zod";
import { IdbKv } from "./idb-kv";

/** En sparad epok är ett uuid; något annat (en gammal eller trasig post) räknas som ingen. */
const storedEpoch = z.string().uuid();

/**
 * Synkpositionen som sparas tillsammans med ett snapshot (#1711): cursorn och
 * epoken den gäller i. Något annat (en trasig post) räknas som ingen position.
 */
export const syncPositionSchema = z.object({
  cursor: z.number().int().nonnegative(),
  epoch: storedEpoch.optional(),
}).strict();

/** Cursorn och epoken den gäller i. */
export type SyncPosition = z.infer<typeof syncPositionSchema>;

/**
 * Flikens position, som snapshotets persistens sparar och läser tillsammans
 * med snapshotet (#1711).
 */
export interface SyncPositionHolder {
  /** Positionen flikens rader i minnet motsvarar just nu. */
  position(): SyncPosition;
  /** Fortsätt från positionen som sparades med det hydrerade snapshotet. */
  restore(position: SyncPosition): void;
}

export interface CursorStore {
  get(): Promise<number>;
  set(cursor: number): Promise<void>;
  /** Epoken cursorn hör till, eller undefined innan servern skickat någon. */
  getEpoch(): Promise<string | undefined>;
  setEpoch(epoch: string): Promise<void>;
}

export class InMemoryCursorStore implements CursorStore, SyncPositionHolder {
  private epoch: string | undefined;
  constructor(private cursor = 0) {}
  async get(): Promise<number> {
    return this.cursor;
  }
  async set(cursor: number): Promise<void> {
    this.cursor = cursor;
  }
  async getEpoch(): Promise<string | undefined> {
    return this.epoch;
  }
  async setEpoch(epoch: string): Promise<void> {
    this.epoch = epoch;
  }
  position(): SyncPosition {
    return this.epoch === undefined ? { cursor: this.cursor } : { cursor: this.cursor, epoch: this.epoch };
  }
  restore(position: SyncPosition): void {
    this.cursor = position.cursor;
    this.epoch = position.epoch;
  }
}

export class IndexedDbCursorStore implements CursorStore {
  private readonly kv: IdbKv;
  constructor(
    factory: IDBFactory = globalThis.indexedDB,
    dbName = "ava-sync-cursor",
  ) {
    this.kv = new IdbKv(factory, dbName, "cursor");
  }
  async get(): Promise<number> {
    return (await this.kv.get<number>("current")) ?? 0;
  }
  async set(cursor: number): Promise<void> {
    await this.kv.put("current", cursor);
  }
  async getEpoch(): Promise<string | undefined> {
    const parsed = storedEpoch.safeParse(await this.kv.get<unknown>("epoch"));
    return parsed.success ? parsed.data : undefined;
  }
  async setEpoch(epoch: string): Promise<void> {
    await this.kv.put("epoch", epoch);
  }
}
