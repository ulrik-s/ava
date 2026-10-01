/**
 * `SyncStore` (#sync-bridge, ADR 0017) — server-sidans delta-sync-port. Den
 * `sync`-routern (delad appRouter) anropar `ctx.sync`; den konkreta
 * Drizzle-impl:en (`DrizzleSyncStore`) injiceras server-side i `createServerContext`
 * så Drizzle/db ALDRIG hamnar i klient-bundeln (dep-cruiser-grind).
 *
 * Org-scopad: routern skickar `ctx.orgId` (server-verifierad principal) — en
 * klient kan inte pulla/pusha för en annan byrå. Pushen får också användaren
 * (#1344): radvägens policy prövar vem som skapar och äger raden.
 */

import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { PullResult, PulledChange, PushResult, RowRef } from "../data-store/in-memory/sync-transport";
import type { RowPusher } from "./row-push-policy";

export interface SyncStore {
  /**
   * Delta-pull: kanoniska ändringar med `seq > sinceCursor` för org:en. Har
   * databasen återställts sedan klienten fick `epoch` börjar den om från 0
   * (`resync`, #1360).
   */
  pull(organizationId: string, sinceCursor: number, epoch?: string): Promise<PullResult>;
  /**
   * Radernas kanoniska läge inom byrån (#1348) — klienten återställer en rad
   * efter en avvisad ändring. Saknad rad (eller en annan byrås) = tombstone.
   */
  rows(organizationId: string, refs: readonly RowRef[]): Promise<PulledChange[]>;
  /** Applicera en köad klient-mutation server-auktoritativt (ADR 0017). */
  push(pusher: RowPusher, mutation: QueuedMutation): Promise<PushResult>;
}
