/**
 * "Att bevaka"-router (#1062) — samlar de fem signalerna i en enda fråga.
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
import { asId, type OrganizationId, userIdSchema } from "@/lib/shared/schemas/ids";
import {
  coverageItems, deadlineItems, failedDispatchItems, overdueInvoiceItems,
  sortWatchlist, unbilledItems,
  DEFAULT_THRESHOLDS, type CoverageMatter, type DeadlineTask, type FailedDispatch,
  type OverdueInvoice, type UnbilledMatter, type WatchlistItem,
} from "@/lib/shared/watchlist";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure } from "../trpc";

type Ctx = { repos: Repositories; orgId: OrganizationId; user: { id: string } };

/** ISO-datum (YYYY-MM-DD) ur ett fält som kan vara Date eller sträng. */
function isoDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
  return null;
}

interface MatterRow {
  id: string;
  matterNumber: string;
  paymentMethod?: string | null;
  rattsskyddMaxOre?: number | null;
  rattshjalpMaxTimmar?: number | null;
  responsibleLawyerId?: string | null;
}

/** Täckningsunderlag: ärendets tak + upparbetat, batchat i ETT repo-anrop. */
async function coverageInput(ctx: Ctx, matters: readonly MatterRow[]): Promise<CoverageMatter[]> {
  const usage = await ctx.repos.timeEntries.coverageUsageForMatters(
    matters.map((m) => asId<"MatterId">(m.id)),
  );
  return matters.map((m) => ({
    id: m.id,
    matterNumber: m.matterNumber,
    method: (m.paymentMethod ?? null) as PaymentMethod | null,
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
async function unbilledInput(ctx: Ctx, matters: readonly MatterRow[]): Promise<UnbilledMatter[]> {
  const entries = await ctx.repos.timeEntries.listBillableForOrg(ctx.orgId);
  const known = new Map(matters.map((m) => [m.id, m]));
  const acc = new Map<string, { ore: number; oldest: string | null }>();

  for (const e of entries) {
    if (e.frozenAt) continue;
    const matterId = String(e.matterId);
    if (!known.has(matterId)) continue;
    const cur = acc.get(matterId) ?? { ore: 0, oldest: null };
    cur.ore += Math.round((e.minutes / 60) * e.hourlyRate);
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

/** Statusar som betyder "fordran lever och kan förfalla". */
const LIVE_INVOICE_STATUSES = new Set(["SENT", "INSTALLMENT_PLAN"]);

/** Förfallna fakturor med utestående belopp. Betalt eller avskrivet räknas bort. */
type InvoiceRow = Awaited<ReturnType<Repositories["invoices"]["listForOrg"]>>[number];

/** Fakturaraden som bevakningspost, eller null om den inte kan förfalla. */
function toOverdue(inv: InvoiceRow): OverdueInvoice | null {
  if (!LIVE_INVOICE_STATUSES.has(String(inv.status))) return null;
  const due = isoDate(inv.dueDate);
  if (due === null) return null;
  const paid = (inv.payments ?? []).reduce((s, p) => s + p.amount, 0);
  return {
    id: String(inv.id), invoiceNumber: inv.invoiceNumber ?? null, dueDate: due,
    outstandingOre: inv.amount - paid,
    matterId: inv.matter ? String(inv.matter.id) : null,
    matterNumber: inv.matter?.matterNumber ?? null,
  };
}

async function overdueInput(ctx: Ctx): Promise<OverdueInvoice[]> {
  const rows = await ctx.repos.invoices.listForOrg(ctx.orgId, {});
  return rows.map(toOverdue).filter((r): r is OverdueInvoice => r !== null);
}

/** Misslyckade fakturautskick — fakturan nådde aldrig mottagaren. */
async function failedInput(ctx: Ctx): Promise<FailedDispatch[]> {
  const rows = await ctx.repos.invoiceDispatches.listByStatusForOrg(ctx.orgId, "failed");
  return rows.map((d) => ({
    invoiceId: String(d.invoiceId),
    invoiceNumber: d.invoice?.invoiceNumber ?? null,
    recipient: d.recipient,
    error: d.error ?? null,
    failedAt: isoDate(d.failedAt),
    matterId: null,
    matterNumber: null,
  }));
}

export const watchlistRouter = router({
  /**
   * Allt som behöver uppmärksamhet, sorterat efter hur bråttom det är.
   *
   * `mine` (default) begränsar ärendedrivna signaler till den egna
   * ärendeportföljen — annars drunknar en delägare i kollegornas ärenden.
   * Tidsfristerna är alltid den egna användarens: en uppgift har en ägare.
   */
  list: orgProcedure
    .input(z.object({
      mine: z.boolean().default(true),
      userId: userIdSchema.optional(),
    }).optional())
    .query(async ({ ctx, input }): Promise<{ items: WatchlistItem[]; generatedAt: string }> => {
      const userId = input?.userId ?? ctx.user.id;
      const mine = input?.mine ?? true;
      const now = new Date();
      // Trösklarna är kodens defaults i v1. De VARIERAR mellan byråer (en byrå
      // fakturerar vid 25 000 kr, en annan vid 50 000) och hör därför hemma i
      // org-inställningarna — men det kräver en migration och hör inte hemma i
      // samma ändring som signalerna själva. Se #1063.
      const thresholds = DEFAULT_THRESHOLDS;

      const all = (await ctx.repos.matters.listByOrg(ctx.orgId)) as MatterRow[];
      const matters = mine ? all.filter((m) => String(m.responsibleLawyerId ?? "") === userId) : all;
      const matterIds = new Set(matters.map((m) => m.id));

      const [coverage, unbilled, deadlines, overdue, failed] = await Promise.all([
        coverageInput(ctx, matters),
        unbilledInput(ctx, matters),
        deadlineInput(ctx, userId),
        overdueInput(ctx),
        failedInput(ctx),
      ]);

      // Faktura-signalerna är org-breda i datalagret; filtrera dem mot samma
      // ärendeurval så "mina" betyder samma sak för alla fem signalerna.
      const ownInvoice = (matterId: string | null): boolean => !mine || matterId === null || matterIds.has(matterId);

      const items = sortWatchlist([
        ...coverageItems(coverage),
        ...unbilledItems(unbilled, now, thresholds),
        ...deadlineItems(deadlines, now, thresholds),
        ...overdueInvoiceItems(overdue.filter((i) => ownInvoice(i.matterId)), now),
        ...failedDispatchItems(failed),
      ]);

      return { items, generatedAt: now.toISOString() };
    }),
});
