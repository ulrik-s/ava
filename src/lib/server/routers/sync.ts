/**
 * `syncRouter` (#sync-bridge, ADR 0017) — server-sidans delta-sync-endpoints.
 * Klientens `TrpcSyncTransport` (offline-first-vägen, #415) pratar med dessa
 * över tRPC-over-HTTP mot server-runtimen (#410/#411).
 *
 * Routern är backend-agnostisk: den anropar `ctx.sync` (SyncStore), som bara
 * injiceras i server-first-runtimen. Körs routern in-process (git/demo) saknas
 * `ctx.sync` → NOT_IMPLEMENTED (den vägen syncar inte mot sig själv).
 * `orgProcedure` ger server-verifierad `ctx.orgId` → en byrå kan inte pulla/pusha
 * en annans data.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { SyncStore } from "../sync/sync-store";
import { orgProcedure, router } from "../trpc";

const queuedMutationSchema = z.object({
  mutationId: z.string(),
  entity: z.string(),
  kind: z.enum(["create", "update", "delete"]),
  row: z.record(z.string(), z.unknown()),
  previous: z.record(z.string(), z.unknown()).optional(),
  baseVersion: z.number().optional(),
  enqueuedAt: z.number(),
});

function requireSync(sync: SyncStore | undefined): SyncStore {
  if (!sync) {
    throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Sync är inte tillgängligt i denna backend." });
  }
  return sync;
}

export const syncRouter = router({
  /** Delta-pull: kanoniska ändringar med `seq > sinceCursor` för org:en. */
  pull: orgProcedure
    .input(z.object({ sinceCursor: z.number().int().nonnegative() }))
    .query(({ ctx, input }) => requireSync(ctx.sync).pull(ctx.orgId, input.sinceCursor)),

  /** Pusha en köad klient-mutation server-auktoritativt. */
  push: orgProcedure
    .input(queuedMutationSchema)
    .mutation(({ ctx, input }) => requireSync(ctx.sync).push(ctx.orgId, input as QueuedMutation)),
});
