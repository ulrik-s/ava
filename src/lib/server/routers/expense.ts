import { z } from "zod";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { Expense } from "@/lib/shared/schemas/billing";
import {
  asId,
  matterIdSchema,
  userIdSchema,
  expenseIdSchema,
  invoiceIdSchema,
} from "@/lib/shared/schemas/ids";
import { isBilledEntry } from "@/lib/shared/time-entry-lock";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";

/**
 * Ett låst utlägg — fakturerat eller fryst av en körning — ändras inte och
 * raderas inte (#1276): samma regel som tidsposterna och synk-pushen.
 */
function assertEditable(expense: Expense): void {
  if (isBilledEntry(expense)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Utlägget ingår i en faktura eller kostnadsräkning och kan inte ändras eller tas bort.",
    });
  }
}

export const expenseRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        matterId: matterIdSchema.optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      })
    )
    // Migrerad till repository-sömmen (ADR 0020): paginerad list + summa via
    // typad listForOrg (org-scope, include + count + sum inkapslat).
    .query(async ({ ctx, input }) => {
      const { expenses, total, totalAmount } = await ctx.repos.expenses.listForOrg(
        ctx.user.organizationId,
        { matterId: input.matterId, page: input.page, pageSize: input.pageSize },
      );
      return {
        expenses,
        total,
        totalAmount,
        pages: Math.ceil(total / input.pageSize),
      };
    }),

  create: orgProcedure
    .input(
      z.object({
        matterId: matterIdSchema,
        date: z.string(),
        amount: z.number().min(1),
        description: z.string().min(1),
        billable: z.boolean().default(true),
        /** Satsen BYRÅN betalade, i basis points (0/600/1200/2500). Default 25 %.
         *  Räknas av innan utlägget debiteras vidare med 25 % (#975). */
        vatRate: z.number().int().nonnegative().max(10000).default(2500),
        /** True om `amount` är inkl moms. Default false — utlägg lagras netto (#782). */
        vatIncluded: z.boolean().default(false),
        /** Äkta utlägg — faktura ställd till klienten → utan moms (#975). */
        passThrough: z.boolean().default(false),
        // Valfria setup-fält (demo-generator/fixtures, ADR 0003).
        id: expenseIdSchema.optional(),
        userId: userIdSchema.optional(),
        invoiceId: invoiceIdSchema.nullable().optional(),
        createdAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ärendet måste tillhöra byrån (#1276) — servern kör om anropet ur kön,
      // och ett utlägg i en annan byrås ärende ska inte gå att skapa.
      const matter = await ctx.repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.repos.expenses.create(omitUndefined({
        id: input.id, // undefined → store genererar
        userId: input.userId ?? asId<"UserId">(ctx.user.id),
        matterId: input.matterId,
        date: new Date(input.date),
        amount: input.amount,
        description: input.description,
        billable: input.billable,
        vatRate: input.vatRate,
        vatIncluded: input.vatIncluded,
        passThrough: input.passThrough,
        invoiceId: input.invoiceId ?? null,
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
      }) satisfies Partial<Expense>);
    }),

  update: orgProcedure
    .input(
      z.object({
        id: expenseIdSchema,
        date: z.string().optional(),
        amount: z.number().min(1).optional(),
        description: z.string().min(1).optional(),
        billable: z.boolean().optional(),
        vatRate: z.number().int().nonnegative().max(10000).optional(),
        vatIncluded: z.boolean().optional(),
        passThrough: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Säkerhet (#60): verifiera org-ägarskap (via matter, samma scopning som
      // `list`) INNAN update. NOT_FOUND vid mismatch — läcker inte existens.
      const owned = await ctx.repos.expenses.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      assertEditable(owned);
      const { id, date, amount, description, billable, vatRate, vatIncluded, passThrough } = input;
      return ctx.repos.expenses.update(id, omitUndefined({
        amount,
        description,
        billable,
        vatRate,
        vatIncluded,
        passThrough,
        ...(date ? { date: new Date(date) } : {}),
      }) satisfies Partial<Expense>);
    }),

  delete: orgProcedure
    .input(z.object({ id: expenseIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.repos.expenses.getByIdInOrg(input.id, ctx.orgId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      assertEditable(owned);
      // Hård delete bevarar dagens beteende (utlägg tombstone-as ej). Se ADR 0017-
      // not om delete-policy (cross-cutting, ej avgjort per router).
      await ctx.repos.expenses.hardDelete(input.id);
      return { id: input.id };
    }),
});
