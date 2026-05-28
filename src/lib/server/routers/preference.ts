/**
 * `preferenceRouter` — sparar/läser kolumn-, sort-, och vy-preferenser
 * per användare (`userPreference`) och valfritt globalt per organisation
 * (`orgPreference`, sätts av ADMIN). Merge-logik på klient-sidan:
 * personal > org > komponent-default.
 *
 * En `key` per UI-vy: "list.contacts", "list.matters", … Hålls medvetet
 * fri-formig så vi inte behöver schema-ändra när vi lägger till nya vyer.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure, protectedProcedure } from "../trpc";

const prefsPayloadSchema = z.record(z.string(), z.unknown());

export const preferenceRouter = router({
  /** Hämta både user- och org-pref för en key (kallaren mergar). */
  get: orgProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [user, org] = await Promise.all([
        ctx.dataStore.userPreferences.findFirst({
          where: { userId: ctx.user.id, organizationId: ctx.user.organizationId, key: input.key },
        }),
        ctx.dataStore.orgPreferences.findFirst({
          where: { organizationId: ctx.user.organizationId, key: input.key },
        }),
      ]);
      return {
        user: (user as { prefs?: Record<string, unknown> } | null)?.prefs ?? null,
        org: (org as { prefs?: Record<string, unknown> } | null)?.prefs ?? null,
      };
    }),

  /** Spara user-pref (upsert). */
  save: protectedProcedure
    .input(z.object({ key: z.string().min(1), prefs: prefsPayloadSchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.dataStore.userPreferences.findFirst({
        where: { userId: ctx.user.id, organizationId: ctx.user.organizationId, key: input.key },
      });
      if (existing) {
        const ex = existing as { id: string };
        return ctx.dataStore.userPreferences.update({ where: { id: ex.id }, data: { prefs: input.prefs } });
      }
      return ctx.dataStore.userPreferences.create({
        data: { userId: ctx.user.id, organizationId: ctx.user.organizationId, key: input.key, prefs: input.prefs },
      });
    }),

  /** Återställ user-pref (faller tillbaka till org/komponent-default). */
  clear: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.dataStore.userPreferences.findFirst({
        where: { userId: ctx.user.id, organizationId: ctx.user.organizationId, key: input.key },
      });
      if (!existing) return { ok: true };
      const ex = existing as { id: string };
      await ctx.dataStore.userPreferences.delete({ where: { id: ex.id } });
      return { ok: true };
    }),

  /** Sätt org-default (endast ADMIN). */
  setOrgDefault: orgProcedure
    .input(z.object({ key: z.string().min(1), prefs: prefsPayloadSchema }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);
      const existing = await ctx.dataStore.orgPreferences.findFirst({
        where: { organizationId: ctx.user.organizationId, key: input.key },
      });
      if (existing) {
        const ex = existing as { id: string };
        return ctx.dataStore.orgPreferences.update({ where: { id: ex.id }, data: { prefs: input.prefs, createdById: ctx.user.id } });
      }
      return ctx.dataStore.orgPreferences.create({
        data: { organizationId: ctx.user.organizationId, key: input.key, prefs: input.prefs, createdById: ctx.user.id },
      });
    }),

  /** Rensa org-default (endast ADMIN). */
  clearOrgDefault: orgProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);
      const existing = await ctx.dataStore.orgPreferences.findFirst({
        where: { organizationId: ctx.user.organizationId, key: input.key },
      });
      if (!existing) return { ok: true };
      const ex = existing as { id: string };
      await ctx.dataStore.orgPreferences.delete({ where: { id: ex.id } });
      return { ok: true };
    }),

  /** Lista alla nycklar som har en org-default (för admin-UI:t). */
  listOrgDefaults: orgProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    return ctx.dataStore.orgPreferences.findMany({
      where: { organizationId: ctx.user.organizationId },
      orderBy: { key: "asc" },
    });
  }),
});

function requireAdmin(role: string | undefined): void {
  if (role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Endast administratörer kan sätta org-defaults." });
  }
}
