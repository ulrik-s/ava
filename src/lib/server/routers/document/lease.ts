/**
 * Lease-procedurer (ADR 0033 §2) — den mjuka leasen som förebygger konflikter.
 *
 * Tunna wrappers runt `ctx.ports.lease` (server-first = InMemoryLeaseStore,
 * demo = no-op). Alla org-scopas via `assertDocAccess` så ingen kan ta en lease
 * på ett annat byrås dokument-id. Hållaren = den inloggade principalen
 * (`ctx.user.id` + `ctx.user.name` för "Anna redigerar").
 *
 * Helper-livscykeln (steg 4) tar/förnyar/släpper; web-UI:t (steg 5) visar
 * "X redigerar" + "Ta över redigeringen".
 */

import { z } from "zod";
import { documentIdSchema } from "@/lib/shared/schemas/ids";
import { orgProcedure } from "../../trpc";
import { assertDocAccess } from "./shared";

const docInput = z.object({ documentId: documentIdSchema });

export const leaseProcedures = {
  /** Ta leasen (fri/utgången/egen → din; annars `acquired:false` + annan hållare). */
  acquireLease: orgProcedure
    .input(docInput)
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      return ctx.ports.lease.acquire(input.documentId, ctx.user.id, ctx.user.name);
    }),

  /** Heartbeat: förnya din lease. `renewed:false` = du håller den inte längre. */
  renewLease: orgProcedure
    .input(docInput)
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      return { renewed: ctx.ports.lease.renew(input.documentId, ctx.user.id) };
    }),

  /** Släpp din lease (vid stäng). Idempotent. */
  releaseLease: orgProcedure
    .input(docInput)
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      ctx.ports.lease.release(input.documentId, ctx.user.id);
      return { ok: true };
    }),

  /** Ta över ett stale/dött lås — permanent omtilldelning till anroparen. */
  takeoverLease: orgProcedure
    .input(docInput)
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      return ctx.ports.lease.takeover(input.documentId, ctx.user.id, ctx.user.name);
    }),

  /** Aktuell lease (vem redigerar, sedan när, stale?) — `null` om fri. */
  getLease: orgProcedure
    .input(docInput)
    .query(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      return { lease: ctx.ports.lease.get(input.documentId) };
    }),
};
