/**
 * Fakturautskick-router (#178) — kanal-agnostisk avsikt + status i git-db:n.
 *
 * `queue` skapar en utskicks-post (status=queued) som BÅDE den manuella vägen
 * (#179) och server-runtime-dispatch-workern (#180) konsumerar. `updateStatus`
 * driver posten genom queued → sent → delivered/failed (idempotent; markera
 * "sent" två gånger ger samma resultat). Allt scopat till ctx.orgId via
 * faktura→ärende-joinen.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { canTransition } from "@/lib/shared/invoice-state-machine";
import { dispatchChannelSchema, dispatchStatusSchema, type DispatchStatus } from "@/lib/shared/schemas/billing";
import type { InvoiceStatus } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import { router, orgProcedure } from "../trpc";

type DispatchCtx = { dataStore: IDataStore; orgId: string };

/** Verifiera org-tillhörighet + returnera fakturans id/status. */
async function assertInvoiceInOrg(ctx: DispatchCtx, invoiceId: string): Promise<{ id: string; status: string }> {
  const inv = (await ctx.dataStore.invoices.findFirst({
    where: { id: invoiceId, matter: { organizationId: ctx.orgId } },
  })) as { id: string; status: string } | null;
  if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Fakturan finns inte i organisationen." });
  return inv;
}

/**
 * En köad/skickad faktura är inte längre ett utkast (#392). Flippa DRAFT → SENT
 * via tillståndsmaskinen (#350); redan utställd faktura lämnas oförändrad.
 */
async function markSentIfDraft(ctx: DispatchCtx, inv: { id: string; status: string }): Promise<void> {
  if (inv.status !== "DRAFT" || !canTransition("DRAFT", "SENT")) return;
  await ctx.dataStore.invoices.update({ where: { id: inv.id }, data: { status: "SENT" satisfies InvoiceStatus } });
}

/** Tidsstämpelfältet som en statusövergång sätter (queued sätts vid skapande). */
const STATUS_TIMESTAMP: Record<DispatchStatus, "sentAt" | "deliveredAt" | "failedAt" | null> = {
  queued: null,
  sent: "sentAt",
  delivered: "deliveredAt",
  failed: "failedAt",
};

export const invoiceDispatchRouter = router({
  list: orgProcedure
    .input(z.object({ invoiceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertInvoiceInOrg(ctx, input.invoiceId);
      return ctx.dataStore.invoiceDispatches.findMany({
        where: { invoiceId: input.invoiceId },
        orderBy: { queuedAt: "desc" },
      });
    }),

  /** Alla köade utskick i org:en — server-runtime-dispatch-workern (#180) plockar dessa. */
  listQueued: orgProcedure.query(async ({ ctx }) => {
    return ctx.dataStore.invoiceDispatches.findMany({
      where: { status: "queued", invoice: { matter: { organizationId: ctx.orgId } } },
      include: { invoice: { select: { id: true, invoiceNumber: true, amount: true, ocrReference: true, dueDate: true } } },
      orderBy: { queuedAt: "asc" },
    });
  }),

  queue: orgProcedure
    .input(z.object({
      invoiceId: z.string(),
      channel: dispatchChannelSchema,
      recipient: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const inv = await assertInvoiceInOrg(ctx, input.invoiceId);
      const now = new Date();
      const dispatch = await ctx.dataStore.invoiceDispatches.create({
        data: {
          invoiceId: asId<"InvoiceId">(input.invoiceId),
          channel: input.channel,
          recipient: input.recipient,
          status: "queued",
          queuedAt: now,
          recordedById: asId<"UserId">(ctx.user.id),
          createdAt: now,
        },
      });
      // Köad för automatiskt utskick → fakturan är inte längre ett utkast (#392).
      await markSentIfDraft(ctx, inv);
      return dispatch;
    }),

  /**
   * Registrera ett MANUELLT utskick som redan skett (#179) — t.ex. när
   * advokaten skickat fakturan via sin egen mailklient (helper compose-mail)
   * eller laddat ner PDF:en och bifogat själv. Skapas direkt som `sent` (med
   * `sentAt`), ALDRIG `queued` — annars skulle server-runtime-dispatch-workern
   * (#180) plocka upp den och skicka igen. AVA kan inte verifiera leverans här:
   * "sent" = "användaren bekräftade att hen skickade".
   */
  recordManual: orgProcedure
    .input(z.object({
      invoiceId: z.string(),
      channel: dispatchChannelSchema,
      recipient: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const inv = await assertInvoiceInOrg(ctx, input.invoiceId);
      const now = new Date();
      const dispatch = await ctx.dataStore.invoiceDispatches.create({
        data: {
          invoiceId: asId<"InvoiceId">(input.invoiceId),
          channel: input.channel,
          recipient: input.recipient,
          status: "sent",
          queuedAt: now,
          sentAt: now,
          recordedById: asId<"UserId">(ctx.user.id),
          createdAt: now,
        },
      });
      // Manuellt skickad → fakturan är inte längre ett utkast (#392).
      await markSentIfDraft(ctx, inv);
      return dispatch;
    }),

  updateStatus: orgProcedure
    .input(z.object({
      dispatchId: z.string(),
      status: dispatchStatusSchema,
      messageId: z.string().optional(),
      error: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const dispatch = await ctx.dataStore.invoiceDispatches.findUnique({ where: { id: input.dispatchId } });
      if (!dispatch) throw new TRPCError({ code: "NOT_FOUND" });
      await assertInvoiceInOrg(ctx, String(dispatch.invoiceId));

      const tsField = STATUS_TIMESTAMP[input.status];
      return ctx.dataStore.invoiceDispatches.update({
        where: { id: input.dispatchId },
        data: {
          status: input.status,
          ...(tsField ? { [tsField]: new Date() } : {}),
          ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
          ...(input.error !== undefined ? { error: input.error } : {}),
        },
      });
    }),
});
