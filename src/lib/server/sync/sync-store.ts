/**
 * `SyncStore` (#sync-bridge, ADR 0017) — server-sidans delta-sync-port. Den
 * `sync`-routern (delad appRouter) anropar `ctx.sync`; den konkreta
 * Drizzle-impl:en (`DrizzleSyncStore`) injiceras server-side i `createServerContext`
 * så Drizzle/db ALDRIG hamnar i klient-bundeln (dep-cruiser-grind).
 *
 * Org-scopad: routern skickar `ctx.orgId` (server-verifierad principal) — en
 * klient kan inte pulla/pusha för en annan byrå.
 */

import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { PullResult, PushResult } from "../data-store/in-memory/sync-transport";

export interface SyncStore {
  /** Delta-pull: kanoniska ändringar med `seq > sinceCursor` för org:en. */
  pull(organizationId: string, sinceCursor: number): Promise<PullResult>;
  /** Applicera en köad klient-mutation server-auktoritativt (ADR 0017). */
  push(organizationId: string, mutation: QueuedMutation): Promise<PushResult>;
}
