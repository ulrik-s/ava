/**
 * Förväntade domstolsbetalningar utan faktura (#173).
 *
 * En `ExpectedReceivable` är en kostnadsräkning till domstol som Domstolsverket
 * betalar — det finns ingen AVA-faktura att pricka av mot. Försiktighetsprincip
 * (3b-ii): `expectedAmount` är ett memo (begärt), `settledAmount` (det domstolen
 * faktiskt betalar) är det som bokas. `settle` registrerar utfallet; skillnaden
 * (prutning) bokförs varken som intäkt eller kundförlust.
 *
 * Org-scopad via raden (`organizationId`) + ärendekoppling (`matterId`).
 * Den AUTOMATISKA camt-fri-text-matchningen (målnummer → settle) är #175;
 * här finns den manuella registreringen + avprickningen.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure } from "../trpc";
import { asId } from "@/lib/shared/schemas/ids";
import { expectedReceivableStatusSchema } from "@/lib/shared/schemas/billing";
import { omitUndefined } from "@/lib/shared/omit-undefined";

type Ctx = { dataStore: { expectedReceivables: { findUnique: (a: unknown) => Promise<unknown> } }; orgId: string };

/** Hämta en fordran och verifiera org-tillhörighet. */
async function assertInOrg(ctx: Ctx, id: string): Promise<{ id: string; status: string }> {
  const row = (await ctx.dataStore.expectedReceivables.findUnique({ where: { id } })) as
    | { id: string; organizationId?: string; status: string }
    | null;
  if (!row || row.organizationId !== ctx.orgId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Fordran finns inte i organisationen." });
  }
  return row;
}

export const expectedReceivableRouter = router({
  /** Lista fordringar i org:en, valfritt filtrerat på ärende. */
  list: orgProcedure
    .input(z.object({ matterId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.dataStore.expectedReceivables.findMany({
        where: {
          organizationId: ctx.orgId,
          ...(input?.matterId ? { matterId: input.matterId } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  /** Registrera en förväntad domstolsbetalning (status PENDING). */
  create: orgProcedure
    .input(z.object({
      matterId: z.string(),
      description: z.string().min(1),
      expectedAmount: z.number().int().nonnegative(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Ärendet måste tillhöra org:en (annars läcker man fordringar in i andra byråer).
      const matter = await ctx.dataStore.matters.findFirst({
        where: { id: input.matterId, organizationId: ctx.orgId },
      });
      if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte i organisationen." });

      const now = new Date();
      return ctx.dataStore.expectedReceivables.create({
        data: {
          matterId: asId<"MatterId">(input.matterId),
          description: input.description,
          expectedAmount: input.expectedAmount,
          status: "PENDING",
          organizationId: asId<"OrganizationId">(ctx.orgId),
          recordedById: asId<"UserId">(ctx.user.id),
          createdAt: now,
          updatedAt: now,
        },
      });
    }),

  /**
   * Pricka av: registrera FAKTISKT utbetalt belopp (3b-ii). Idempotent på
   * `paymentReference` — en redan avprickad betalning (samma externalId)
   * skrivs inte två gånger (camt-peern, #175, kan köra om samma fil).
   */
  settle: orgProcedure
    .input(z.object({
      id: z.string(),
      settledAmount: z.number().int().nonnegative(),
      settledAt: z.string().optional(),
      paymentReference: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertInOrg(ctx, input.id);
      return ctx.dataStore.expectedReceivables.update({
        where: { id: input.id },
        data: {
          status: "SETTLED",
          settledAmount: input.settledAmount,
          settledAt: input.settledAt ? new Date(input.settledAt) : new Date(),
          ...(input.paymentReference !== undefined ? { paymentReference: input.paymentReference } : {}),
          updatedAt: new Date(),
        },
      });
    }),

  /** Avbryt en fordran (t.ex. felregistrerad eller domstolen avslog helt). */
  cancel: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertInOrg(ctx, input.id);
      return ctx.dataStore.expectedReceivables.update({
        where: { id: input.id },
        data: { status: "CANCELLED", updatedAt: new Date() },
      });
    }),

  /** Uppdatera memo-fälten (begärt belopp/beskrivning) medan PENDING. */
  update: orgProcedure
    .input(z.object({
      id: z.string(),
      description: z.string().min(1).optional(),
      expectedAmount: z.number().int().nonnegative().optional(),
      status: expectedReceivableStatusSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertInOrg(ctx, input.id);
      const { id, ...rest } = input;
      return ctx.dataStore.expectedReceivables.update({
        where: { id },
        data: { ...omitUndefined(rest), updatedAt: new Date() },
      });
    }),
});
