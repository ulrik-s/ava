/**
 * `preferenceRouter` — sparar/läser kolumn-, sort-, och vy-preferenser
 * per användare (`userPreference`) och valfritt globalt per organisation
 * (`orgPreference`, sätts av ADMIN). Merge-logik på klient-sidan:
 * personal > org > komponent-default.
 *
 * En `key` per UI-vy: "list.contacts", "list.matters", … Hålls medvetet
 * fri-formig så vi inte behöver schema-ändra när vi lägger till nya vyer.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { OrgPreferenceRow } from "../repositories/org-preference-repository";
import type { UserPreferenceRow } from "../repositories/user-preference-repository";
import { router, orgProcedure, protectedProcedure } from "../trpc";

const prefsPayloadSchema = z.record(z.string(), z.unknown());

export const preferenceRouter = router({
  /** Hämta både user- och org-pref för en key (kallaren mergar). */
  get: orgProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [user, org] = await Promise.all([
        ctx.repos.userPreferences.getByUserKey(ctx.user.id, ctx.user.organizationId, input.key),
        ctx.repos.orgPreferences.getByOrgKey(ctx.user.organizationId, input.key),
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
      const existing = await ctx.repos.userPreferences.getByUserKey(ctx.user.id, ctx.user.organizationId, input.key);
      if (existing) {
        return ctx.repos.userPreferences.update(existing.id, { prefs: input.prefs } as Partial<UserPreferenceRow>);
      }
      return ctx.repos.userPreferences.create({
        userId: ctx.user.id, organizationId: ctx.user.organizationId, key: input.key, prefs: input.prefs,
      } as Partial<UserPreferenceRow>);
    }),

  /** Återställ user-pref (faller tillbaka till org/komponent-default). */
  clear: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.repos.userPreferences.getByUserKey(ctx.user.id, ctx.user.organizationId, input.key);
      if (!existing) return { ok: true };
      await ctx.repos.userPreferences.hardDelete(existing.id);
      return { ok: true };
    }),

  /** Sätt org-default (endast ADMIN). */
  setOrgDefault: orgProcedure
    .input(z.object({ key: z.string().min(1), prefs: prefsPayloadSchema }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);
      const existing = await ctx.repos.orgPreferences.getByOrgKey(ctx.user.organizationId, input.key);
      if (existing) {
        return ctx.repos.orgPreferences.update(existing.id, { prefs: input.prefs, createdById: ctx.user.id } as Partial<OrgPreferenceRow>);
      }
      return ctx.repos.orgPreferences.create({
        organizationId: ctx.user.organizationId, key: input.key, prefs: input.prefs, createdById: ctx.user.id,
      } as Partial<OrgPreferenceRow>);
    }),

  /** Rensa org-default (endast ADMIN). */
  clearOrgDefault: orgProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);
      const existing = await ctx.repos.orgPreferences.getByOrgKey(ctx.user.organizationId, input.key);
      if (!existing) return { ok: true };
      await ctx.repos.orgPreferences.hardDelete(existing.id);
      return { ok: true };
    }),

  /** Lista alla nycklar som har en org-default (för admin-UI:t). */
  listOrgDefaults: orgProcedure.query(({ ctx }) => {
    requireAdmin(ctx.user.role);
    return ctx.repos.orgPreferences.listByOrg(ctx.user.organizationId);
  }),
});

function requireAdmin(role: string | undefined): void {
  if (role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Endast administratörer kan sätta org-defaults." });
  }
}
