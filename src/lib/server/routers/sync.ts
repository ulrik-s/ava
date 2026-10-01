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
import { assertAdmin } from "../auth/assert-admin";
import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import { MAX_ROW_REFS } from "../data-store/in-memory/sync-transport";
import { analyzeIfNewContent, storagePathBefore } from "../sync/classify-new-content";
import type { SyncDeviceStore } from "../sync/sync-device-store";
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

/** En utpekad rad: entitet + id (procedur-anropens `touches`, #1348:s `rows`). */
const rowRefSchema = z.object({ entity: z.string().max(100), id: z.string().max(100) });

/** Ett köat procedur-anrop (#1265, ADR 0037). Fälten i `input` valideras av proceduren själv. */
const queuedProcedureCallSchema = z.object({
  type: z.literal("procedure"),
  mutationId: z.string().uuid(),
  path: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()),
  codeVersion: z.string().max(200),
  touches: z.array(rowRefSchema).max(MAX_ROW_REFS),
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

/** En enhets rapport (#1267). Etiketten är kort text om webbläsaren, aldrig innehåll. */
const deviceReportSchema = z.object({
  deviceId: z.string().uuid(),
  label: z.string().max(120).nullable(),
  pendingCount: z.number().int().nonnegative(),
  oldestPendingAt: z.number().int().nonnegative().nullable(),
  /** Felet som stoppade synken (#1353). Saknas från klienter före fältet. */
  lastError: z.string().max(300).nullable().default(null),
});

function requireDevices(store: SyncDeviceStore | undefined): SyncDeviceStore {
  if (!store) {
    throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Synkuppföljning är inte tillgänglig i denna backend." });
  }
  return store;
}

export const syncRouter = router({
  /**
   * Enhetens synkläge efter en synk (#1267): köns längd, den äldsta
   * osynkade ändringen och felet om synken misslyckades (#1353). Servern
   * stämplar när rapporten kom.
   */
  reportDevice: orgProcedure
    .input(deviceReportSchema)
    .mutation(async ({ ctx, input }) => {
      await requireDevices(ctx.syncDevices).report(ctx.orgId, ctx.user.id, input);
      return { ok: true as const };
    }),

  /** Byråns enheter och deras synkläge — bara för admin (#1267). */
  devices: orgProcedure.query(({ ctx }) => {
    assertAdmin(ctx);
    return requireDevices(ctx.syncDevices).list(ctx.orgId);
  }),

  /** Glöm en utrangerad enhet — bara för admin (#1267). */
  forgetDevice: orgProcedure
    .input(z.object({ deviceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx);
      await requireDevices(ctx.syncDevices).forget(ctx.orgId, input.deviceId);
      return { ok: true as const };
    }),

  /** Delta-pull: kanoniska ändringar med `seq > sinceCursor` för org:en. */
  pull: orgProcedure
    .input(z.object({ sinceCursor: z.number().int().nonnegative() }))
    .query(({ ctx, input }) => requireSync(ctx.sync).pull(ctx.orgId, input.sinceCursor)),

  /**
   * Radernas kanoniska läge (#1348): klienten återställer raderna en avvisad
   * ändring rörde. Org-scopat — en rad som inte finns hos byrån (eller hör
   * till en annan) blir en tombstone. Samma rader som pullen visar; en läsning,
   * men POST (mutation): hundra id:n ryms inte säkert i en GET-URL.
   */
  rows: orgProcedure
    .input(z.object({ refs: z.array(rowRefSchema).max(MAX_ROW_REFS) }))
    .mutation(({ ctx, input }) => requireSync(ctx.sync).rows(ctx.orgId, input.refs)),

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
      const result = await sync.push({ organizationId: ctx.orgId, userId: ctx.user.id }, m);
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
