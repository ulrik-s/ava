/**
 * Förhör i förordnandemål (#1855, DVFS 2025:5).
 *
 * Ett förhör under förundersökningen där försvararen närvarade: början, slut
 * och uppehåll. Raderna har samma form som domänens `Forhor`
 * (`forordnandetaxa.ts`), så kostnadsräkningen kan läsa dem rakt av.
 *
 * Org-scopad via raden (`organizationId`) + ärendekoppling (`matterId`), som
 * domstolsbetalningarna (`expectedReceivable.ts`). Procedurägd (ADR 0037):
 * förhören styr ett belopp, så servern kör om anropen och tar inte emot
 * färdiga rader. Reglerna för tiderna är den rena funktionen
 * `interrogationTimesProblem`, som formuläret också använder.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { asId, interrogationIdSchema, matterIdSchema, type InterrogationId, type OrganizationId } from "@/lib/shared/schemas/ids";
import {
  interrogationPauseSchema, interrogationTimesSchema,
  type Interrogation, type InterrogationPause,
} from "@/lib/shared/schemas/interrogation";
import { newRowId } from "../queued-call";
import type { Repositories } from "../repositories/repositories";
import { orgProcedure, router } from "../trpc";

/** Tiderna som reglerna prövar: början, slut och uppehåll. */
export interface InterrogationTimesInput {
  start: Date | string;
  end: Date | string;
  pauses: readonly InterrogationPause[];
}

const ms = (t: Date | string): number => new Date(t).getTime();

/** Ligger uppehållet inom förhöret, med slutet efter början? */
function pauseInside(p: InterrogationPause, start: number, end: number): boolean {
  return ms(p.end) > ms(p.start) && ms(p.start) >= start && ms(p.end) <= end;
}

/** Överlappar något uppehåll ett annat (ett börjar innan det förra slutat)? */
function pausesOverlap(pauses: readonly InterrogationPause[]): boolean {
  const sorted = [...pauses].sort((a, b) => ms(a.start) - ms(b.start));
  return sorted.some((p, i) => i > 0 && ms(p.start) < ms(sorted[i - 1]?.end ?? p.start));
}

/**
 * Reglerna för ett förhörs tider: slutet efter början, varje uppehåll inom
 * förhöret och utan överlapp med ett annat. Ger felbeskedet, eller `null` när
 * tiderna håller. Ren funktion — formuläret prövar samma regler.
 */
export function interrogationTimesProblem(t: InterrogationTimesInput): string | null {
  const start = ms(t.start);
  const end = ms(t.end);
  if (!(end > start)) return "Förhöret måste sluta efter att det börjat.";
  if (!t.pauses.every((p) => pauseInside(p, start, end))) return "Ett uppehåll måste ligga inom förhöret.";
  if (pausesOverlap(t.pauses)) return "Två uppehåll får inte överlappa varandra.";
  return null;
}

/** Pröva reglerna; bryt med `BAD_REQUEST` om de inte håller. */
function assertTimes(t: InterrogationTimesInput): void {
  const problem = interrogationTimesProblem(t);
  if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
}

/** Hämta ett förhör och verifiera byrån (repository-sömmen, ADR 0020). */
async function assertInOrg(repos: Repositories, orgId: OrganizationId, id: InterrogationId): Promise<Interrogation> {
  const row = await repos.interrogations.getByIdInOrg(id, orgId);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Förhöret finns inte i organisationen." });
  return row;
}

const updateInput = z.object({
  id: interrogationIdSchema,
  start: z.iso.datetime({ offset: true }).optional(),
  end: z.iso.datetime({ offset: true }).optional(),
  pauses: z.array(interrogationPauseSchema).optional(),
});
type UpdateInput = z.infer<typeof updateInput>;

/** Raden efter ändringen: de fält anropet bär, annars radens. */
function mergedTimes(row: Interrogation, input: UpdateInput): InterrogationTimesInput {
  return { start: input.start ?? row.start, end: input.end ?? row.end, pauses: input.pauses ?? row.pauses };
}

export const interrogationRouter = router({
  /** Ärendets förhör, äldst först. */
  list: orgProcedure
    .input(z.object({ matterId: matterIdSchema }))
    .query(({ ctx, input }) => ctx.repos.interrogations.listForMatter(ctx.orgId, input.matterId)),

  /** Registrera ett förhör i ett av byråns ärenden. */
  create: orgProcedure
    .input(interrogationTimesSchema.extend({ matterId: matterIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const matter = await ctx.repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte i organisationen." });
      assertTimes(input);
      const now = new Date();
      return ctx.repos.interrogations.create({
        id: asId<"InterrogationId">(newRowId(ctx, "interrogation")),
        organizationId: ctx.orgId,
        matterId: input.matterId,
        start: new Date(input.start),
        end: new Date(input.end),
        pauses: input.pauses,
        createdAt: now,
        updatedAt: now,
      } satisfies Partial<Interrogation>);
    }),

  /** Ändra ett förhörs tider; reglerna prövas på raden som den blir. */
  update: orgProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const row = await assertInOrg(ctx.repos, ctx.orgId, input.id);
      const next = mergedTimes(row, input);
      assertTimes(next);
      return ctx.repos.interrogations.update(input.id, {
        start: new Date(next.start),
        end: new Date(next.end),
        pauses: [...next.pauses],
        updatedAt: new Date(),
      } satisfies Partial<Interrogation>);
    }),

  /** Ta bort ett förhör (mjukt: tombstone, ADR 0017). */
  delete: orgProcedure
    .input(z.object({ id: interrogationIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertInOrg(ctx.repos, ctx.orgId, input.id);
      await ctx.repos.interrogations.softDelete(input.id);
      return { id: input.id };
    }),
});
