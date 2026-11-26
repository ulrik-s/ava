/**
 * Frister-router (#1062, #1735): tidsfrister och "Bör faktureras" i `list`,
 * takvarningar och jävskontroller i `actionItems` (#1734).
 *
 * Varje signal härleds ur data som redan finns; ingenting lagras. Se
 * `@/lib/shared/watchlist` för varför (kort: en härledd påminnelse städar sig
 * själv, en lagrad kräver att någon avfärdar den).
 *
 * Läsningarna görs org-brett och i EN omgång per entitetstyp i st.f. per
 * ärende. Ett N+1-mönster hade betytt ett anrop per ärende varje gång
 * startsidan laddas — och startsidan laddas hela dagen.
 */

import { z } from "zod";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import { asId, matterIdSchema, type OrganizationId, userIdSchema } from "@/lib/shared/schemas/ids";
import { stockholmDay } from "@/lib/shared/stockholm-time";
import {
  conflictCheckItems, coverageItems, deadlineItems, sortWatchlist, unbilledItems, withKlientNames,
  DEFAULT_THRESHOLDS, type CoverageMatter, type DeadlineTask, type UnbilledMatter, type WatchlistItem,
} from "@/lib/shared/watchlist";
import { timeEntryValueOre } from "@/lib/shared/whole-kronor";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure } from "../trpc";

type Ctx = { repos: Repositories; orgId: OrganizationId; user: { id: string } };

/** ISO-datum (YYYY-MM-DD) ur ett fält som kan vara Date eller sträng. */
function isoDate(v: unknown): string | null {
  // Svensk kalenderdag, inte UTC (#1167) — se stockholmDay.
  if (v instanceof Date) return stockholmDay(v);
  // Ren datumsträng ("2026-09-25") är redan en kalenderdag; en tidpunkt
  // (demodatalagrets ISO-strängar, "…T22:00:00.000Z") räknas om till svensk dag.
  if (typeof v === "string" && v.length === 10) return v;
  if (typeof v === "string" && v.length > 10) return stockholmDay(new Date(v));
  return null;
}

interface MatterRow {
  id: string;
  matterNumber: string;
  status?: string | null;
  paymentMethod?: PaymentMethod | null;
  rattsskyddMaxOre?: number | null;
  rattshjalpMaxTimmar?: number | null;
  responsibleLawyerId?: string | null;
  conflictCheckStatus?: string | null;
  conflictCheckHits?: number | null;
}

/**
 * Klientens namn på posterna (#1965): parterna för ärendena i posterna, lästa i
 * ETT repo-anrop oavsett antal ärenden. Inga ärenden → inget anrop.
 */
async function withClients(ctx: Ctx, items: readonly WatchlistItem[]): Promise<WatchlistItem[]> {
  const ids = [...new Set(items.flatMap((i) => (i.matterId === null ? [] : [i.matterId])))];
  if (ids.length === 0) return [...items];
  const parties = await ctx.repos.matters.listPartiesFor(ctx.orgId, ids.map((id) => asId<"MatterId">(id)));
  return withKlientNames(items, parties);
}

/** Täckningsunderlag: ärendets tak + upparbetat, batchat i ETT repo-anrop. */
async function coverageInput(ctx: Ctx, matters: readonly MatterRow[]): Promise<CoverageMatter[]> {
  const usage = await ctx.repos.timeEntries.coverageUsageForMatters(
    matters.map((m) => asId<"MatterId">(m.id)),
  );
  return matters.map((m) => ({
    id: m.id,
    matterNumber: m.matterNumber,
    method: m.paymentMethod ?? null,
    rattsskyddMaxOre: m.rattsskyddMaxOre ?? null,
    rattshjalpMaxTimmar: m.rattshjalpMaxTimmar ?? null,
    billableMinutes: usage[m.id]?.billableMinutes ?? 0,
    billableValueOre: usage[m.id]?.billableValueOre ?? 0,
  }));
}

/**
 * Ofakturerat per ärende: debiterbara tidsposter som INTE frysts av en
 * slutfaktura. `frozenAt` är gränsen — aconto fryser inte, så ett ärende med
 * aconto har fortfarande upparbetat kvar att slutfakturera.
 */
type EntryRow = Awaited<ReturnType<Repositories["timeEntries"]["listBillableForOrg"]>>[number];

function unbilledInput(matters: readonly MatterRow[], entries: readonly EntryRow[]): UnbilledMatter[] {
  const known = new Map(matters.map((m) => [m.id, m]));
  const acc = new Map<string, { ore: number; oldest: string | null }>();

  for (const e of entries) {
    if (e.frozenAt) continue;
    const matterId = String(e.matterId);
    if (!known.has(matterId)) continue;
    const cur = acc.get(matterId) ?? { ore: 0, oldest: null };
    cur.ore += timeEntryValueOre(e.minutes, e.hourlyRate);
    const d = isoDate(e.date);
    if (d !== null && (cur.oldest === null || d < cur.oldest)) cur.oldest = d;
    acc.set(matterId, cur);
  }

  return [...acc].map(([matterId, v]) => ({
    id: matterId,
    matterNumber: known.get(matterId)?.matterNumber ?? matterId,
    unbilledOre: v.ore,
    oldestEntryDate: v.oldest,
  }));
}

/** Tidsfrister ur uppgifter — bara öppna, och bara de som har ett datum. */
async function deadlineInput(ctx: Ctx, userId: string): Promise<DeadlineTask[]> {
  const tasks = await ctx.repos.tasks.listForUser(
    asId<"UserId">(userId), ctx.orgId, { status: "TODO" },
  );
  const out: DeadlineTask[] = [];
  for (const t of tasks) {
    const due = isoDate(t.dueAt);
    if (due === null) continue;
    out.push({
      id: String(t.id), title: t.title, dueAt: due,
      matterId: t.matter ? String(t.matter.id) : null,
      matterNumber: t.matter?.matterNumber ?? null,
    });
  }
  return out;
}

/** "Bara mina ärenden": ärenden där användaren är ansvarig, annars hela byrån. */
async function selectMatters(ctx: Ctx, userId: string, mine: boolean): Promise<MatterRow[]> {
  const all = (await ctx.repos.matters.listByOrg(ctx.orgId)) as MatterRow[];
  return mine ? all.filter((m) => String(m.responsibleLawyerId ?? "") === userId) : all;
}

const scopeInput = z.object({
  mine: z.boolean().default(true),
  userId: userIdSchema.optional(),
});

export const watchlistRouter = router({
  /**
   * Frister (#1735): tidsfrister och "Bör faktureras", sorterade efter hur
   * bråttom det är. Övriga signaler står på sina egna platser.
   *
   * `mine` (default) begränsar "Bör faktureras" till den egna
   * ärendeportföljen — annars drunknar en delägare i kollegornas ärenden.
   * Tidsfristerna är alltid den egna användarens: en uppgift har en ägare.
   */
  list: orgProcedure
    .input(scopeInput.extend({
      /** Bara ett ärendes poster — fliken Frister i ärendet (#1167). */
      matterId: matterIdSchema.optional(),
    }).optional())
    .query(async ({ ctx, input }): Promise<{ items: WatchlistItem[]; generatedAt: string }> => {
      const userId = input?.userId ?? ctx.user.id;
      const now = new Date();
      // Trösklarna är kodens defaults i v1. De VARIERAR mellan byråer (en byrå
      // fakturerar vid 25 000 kr, en annan vid 50 000) och hör därför hemma i
      // org-inställningarna — men det kräver en migration och hör inte hemma i
      // samma ändring som signalerna själva. Se #1063.
      const thresholds = DEFAULT_THRESHOLDS;

      const [matters, entries, deadlines] = await Promise.all([
        selectMatters(ctx, userId, input?.mine ?? true),
        ctx.repos.timeEntries.listBillableForOrg(ctx.orgId),
        deadlineInput(ctx, userId),
      ]);
      const items = sortWatchlist([
        ...unbilledItems(unbilledInput(matters, entries), now, thresholds),
        ...deadlineItems(deadlines, now, thresholds),
      ], stockholmDay(now));

      const scoped = input?.matterId ? items.filter((i) => i.matterId === String(input.matterId)) : items;
      return { items: await withClients(ctx, scoped), generatedAt: now.toISOString() };
    }),

  /**
   * "Att åtgärda" (#1734): takvarningar och jävskontroller med träffar som
   * ingen har bedömt. En kontroll som bara väntar (`PENDING`) hör inte hit.
   * Samma `mine`-urval och sortering som `list`.
   */
  actionItems: orgProcedure
    .input(scopeInput.optional())
    .query(async ({ ctx, input }): Promise<{ items: WatchlistItem[]; generatedAt: string }> => {
      const now = new Date();
      const matters = await selectMatters(ctx, input?.userId ?? ctx.user.id, input?.mine ?? true);
      const items = sortWatchlist([
        ...coverageItems(await coverageInput(ctx, matters)),
        ...conflictCheckItems(matters.filter((m) => m.conflictCheckStatus === "HITS")),
      ], stockholmDay(now));
      return { items, generatedAt: now.toISOString() };
    }),
});
