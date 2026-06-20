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

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { ExpectedReceivable } from "@/lib/shared/schemas/billing";
import { expectedReceivableStatusSchema } from "@/lib/shared/schemas/billing";
import { asId, expectedReceivableIdSchema, matterIdSchema } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure } from "../trpc";

/** Hämta en fordran och verifiera org-tillhörighet (repository-sömmen, ADR 0020). */
async function assertInOrg(repos: Repositories, orgId: string, id: string): Promise<ExpectedReceivable> {
  const row = await repos.expectedReceivables.getByIdInOrg(id, orgId);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Fordran finns inte i organisationen." });
  return row;
}

export const expectedReceivableRouter = router({
  /** Lista fordringar i org:en, valfritt filtrerat på ärende. */
  list: orgProcedure
    .input(z.object({ matterId: matterIdSchema.optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.repos.expectedReceivables.listForOrg(ctx.orgId, { matterId: input?.matterId }),
    ),

  /**
   * Matchnings-kandidater för camt-avprickning (#175): öppna (PENDING)
   * fordringar berikade med ärende-/målnummer (matchningsnycklarna). Belopp
   * och referens matchas client-side av `matchReceivables`.
   */
  candidates: orgProcedure.query(async ({ ctx }) => {
    const rows = (await ctx.repos.expectedReceivables.listForOrg(ctx.orgId, { status: "PENDING" })) as
      Array<{ id: string; matterId: string; description: string; expectedAmount: number }>;
    const matters = (await ctx.repos.matters.listByOrg(ctx.orgId)) as
      Array<{ id: string; matterNumber?: string | null; courtCaseNumber?: string | null }>;
    const byId = new Map(matters.map((m) => [String(m.id), m]));
    return rows.map((r) => {
      const m = byId.get(String(r.matterId));
      return {
        id: String(r.id),
        description: r.description,
        expectedAmount: r.expectedAmount,
        matterId: String(r.matterId),
        matterNumber: m?.matterNumber ?? null,
        courtCaseNumber: m?.courtCaseNumber ?? null,
      };
    });
  }),

  /** Registrera en förväntad domstolsbetalning (status PENDING). */
  create: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      description: z.string().min(1),
      expectedAmount: z.number().int().nonnegative(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Ärendet måste tillhöra org:en (annars läcker man fordringar in i andra byråer).
      const matter = await ctx.repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte i organisationen." });

      const now = new Date();
      return ctx.repos.expectedReceivables.create({
        matterId: asId<"MatterId">(input.matterId),
        description: input.description,
        expectedAmount: input.expectedAmount,
        status: "PENDING",
        organizationId: asId<"OrganizationId">(ctx.orgId),
        recordedById: asId<"UserId">(ctx.user.id),
        createdAt: now,
        updatedAt: now,
      } as Partial<ExpectedReceivable>);
    }),

  /**
   * Pricka av: registrera FAKTISKT utbetalt belopp (3b-ii). Idempotent på
   * `paymentReference` — en redan avprickad betalning (samma externalId)
   * skrivs inte två gånger (camt-peern, #175, kan köra om samma fil).
   */
  settle: orgProcedure
    .input(z.object({
      id: expectedReceivableIdSchema,
      settledAmount: z.number().int().nonnegative(),
      settledAt: z.string().optional(),
      paymentReference: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertInOrg(ctx.repos, ctx.orgId, input.id);
      return ctx.repos.expectedReceivables.update(input.id, {
        status: "SETTLED",
        settledAmount: input.settledAmount,
        settledAt: input.settledAt ? new Date(input.settledAt) : new Date(),
        ...(input.paymentReference !== undefined ? { paymentReference: input.paymentReference } : {}),
        updatedAt: new Date(),
      } as Partial<ExpectedReceivable>);
    }),

  /** Avbryt en fordran (t.ex. felregistrerad eller domstolen avslog helt). */
  cancel: orgProcedure
    .input(z.object({ id: expectedReceivableIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertInOrg(ctx.repos, ctx.orgId, input.id);
      return ctx.repos.expectedReceivables.update(input.id, { status: "CANCELLED", updatedAt: new Date() } as Partial<ExpectedReceivable>);
    }),

  /** Uppdatera memo-fälten (begärt belopp/beskrivning) medan PENDING. */
  update: orgProcedure
    .input(z.object({
      id: expectedReceivableIdSchema,
      description: z.string().min(1).optional(),
      expectedAmount: z.number().int().nonnegative().optional(),
      status: expectedReceivableStatusSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertInOrg(ctx.repos, ctx.orgId, input.id);
      const { id, ...rest } = input;
      return ctx.repos.expectedReceivables.update(id, { ...omitUndefined(rest), updatedAt: new Date() } as Partial<ExpectedReceivable>);
    }),
});
