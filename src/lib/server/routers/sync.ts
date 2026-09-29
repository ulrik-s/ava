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
import { analyzeIfNewContent, storagePathBefore } from "../sync/classify-new-content";
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
  /** Köformatet (#1247) — saknas på poster köade före stämplingen. */
  format: z.number().int().positive().optional(),
});

/** Ett köat procedur-anrop (#1265, ADR 0037). Fälten i `input` valideras av proceduren själv. */
const queuedProcedureCallSchema = z.object({
  type: z.literal("procedure"),
  mutationId: z.string().uuid(),
  path: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()),
  codeVersion: z.string().max(200),
  touches: z.array(z.object({ entity: z.string().max(100), id: z.string().max(100) })).max(100),
  enqueuedAt: z.number(),
  /** Köformatet (#1247) — saknas på poster köade före stämplingen. */
  format: z.number().int().positive().optional(),
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

  /**
   * Pusha en köad klient-mutation server-auktoritativt. Fick ett dokument nytt
   * innehåll som servern redan har, klassar servern det (#1156).
   */
  push: orgProcedure
    .input(queuedMutationSchema)
    .mutation(async ({ ctx, input }) => {
      const sync = requireSync(ctx.sync);
      const m = input as QueuedMutation;
      const before = await storagePathBefore(ctx.repos, m);
      const result = await sync.push(ctx.orgId, m);
      await analyzeIfNewContent({ content: ctx.ports.content, analyzer: ctx.ports.documentAnalyzer }, m, before, result);
      return result;
    }),

  /**
   * Kör om ett köat procedur-anrop auktoritativt som den inloggade (#1265,
   * ADR 0037). Svarar med utfallet och de berörda radernas kanoniska läge.
   */
  replay: orgProcedure
    .input(queuedProcedureCallSchema)
    .mutation(({ ctx, input }) => {
      if (!ctx.replayProcedure) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Omkörning av köade anrop finns inte i denna backend." });
      }
      return ctx.replayProcedure(input);
    }),
});
