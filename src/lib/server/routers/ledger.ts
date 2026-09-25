/**
 * `ledger` — bokföring i byråns bokföringssystem från appen (#1172).
 *
 * Anslutningen (OAuth) görs av en administratör i Inställningar; bokföringen
 * av en utställd faktura kan göras av alla i byrån. Connectorn nås bara via
 * `ctx.ports.ledger` — routern känner inte till Fortnox (ADR 0011).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ledgerAccountMapSchema, type LedgerAccountMap } from "@/lib/shared/accounting/account-map";
import { invoiceIdSchema, type OrganizationId } from "@/lib/shared/schemas/ids";
import { assertAdmin } from "../auth/assert-admin";
import { bookUnbookedInvoices, isBookable, type BookableInvoice } from "../integrations/ledger/book-invoices";
import { orgProcedure, router } from "../trpc";
import type { Context } from "../trpc-core";

/** Fel från porten (nätet, Fortnox, saknad config) som ett läsbart tRPC-fel. */
function asTrpcError(e: unknown): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
}

type Ctx = Pick<Context, "repos" | "ports"> & { orgId: OrganizationId };
type FullInvoice = NonNullable<Awaited<ReturnType<Context["repos"]["invoices"]["getByIdFull"]>>>;

/** Byråns sparade kontomappning — utan den vet vi inte vilka konton som gäller. */
async function requireAccountMap(ctx: Ctx): Promise<LedgerAccountMap> {
  const org = await ctx.repos.organizations.getById(ctx.orgId);
  const map = ledgerAccountMapSchema.safeParse(org?.ledgerAccountMap);
  if (!map.success) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Spara kontomappningen under Inställningar → Bokföring först." });
  }
  return map.data;
}

/** Fakturan i den form bokföringsdrivrutinen vill ha. */
function toBookable(inv: FullInvoice): BookableInvoice {
  return {
    id: inv.id, amount: inv.amount, vatOre: inv.vatOre ?? null, vatBreakdown: inv.vatBreakdown ?? null,
    invoiceDate: inv.invoiceDate, invoiceNumber: inv.invoiceNumber ?? null, status: inv.status,
    fortnoxId: inv.fortnoxId ?? null, matter: { matterNumber: inv.matter?.matterNumber ?? null },
  };
}

function connectorOrThrow(ctx: Ctx, map: LedgerAccountMap): ReturnType<Context["ports"]["ledger"]["connector"]> {
  try {
    return ctx.ports.ledger.connector(ctx.orgId, map);
  } catch (e) {
    throw asTrpcError(e);
  }
}

export const ledgerRouter = router({
  status: orgProcedure.query(({ ctx }) => ctx.ports.ledger.status(ctx.orgId)),

  connectUrl: orgProcedure.mutation(async ({ ctx }) => {
    assertAdmin(ctx);
    return { url: await ctx.ports.ledger.authorizeUrl(ctx.orgId).catch((e: unknown) => { throw asTrpcError(e); }) };
  }),

  completeConnect: orgProcedure
    .input(z.object({ code: z.string().min(1), state: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx);
      await ctx.ports.ledger.completeConnect(ctx.orgId, input.code, input.state)
        .catch((e: unknown) => { throw asTrpcError(e); });
      return { connected: true };
    }),

  /** Bokför EN utställd faktura och skriv tillbaka verifikatets id. Idempotent. */
  bookInvoice: orgProcedure
    .input(z.object({ invoiceId: invoiceIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const inv = await ctx.repos.invoices.getByIdFull(input.invoiceId, ctx.orgId);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      if (inv.fortnoxId) return { externalId: inv.fortnoxId };
      const map = await requireAccountMap(ctx);
      const bookable = toBookable(inv);
      if (!isBookable(bookable)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Bara utställda fakturor kan bokföras (inte utkast eller makulerade)." });
      }
      const [outcome] = await bookUnbookedInvoices({
        invoices: [bookable],
        connector: connectorOrThrow(ctx, map),
        markBooked: (_id, externalId) => ctx.repos.invoices.update(inv.id, { fortnoxId: externalId }),
      });
      if (!outcome?.externalId) throw asTrpcError(new Error(outcome?.error ?? "Bokföringen gav inget verifikat."));
      return { externalId: outcome.externalId };
    }),
});
