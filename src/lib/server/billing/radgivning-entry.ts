/**
 * "Markera som rådgivning" (#1207) — serversidan av rådgivningspostens regel
 * (`@/lib/shared/radgivning-entry`). Hämtar det predikatet behöver och utför
 * låsningen/delningen inne i anroparens transaktion.
 */
import { TRPCError } from "@trpc/server";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import {
  entryMarkBlocker,
  findRadgivningInvoiceId,
  markTarget,
  radgivningEntryStatus,
  splitRadgivningMinutes,
  type RadgivningEntryStatus,
} from "@/lib/shared/radgivning-entry";
import type { TimeEntry } from "@/lib/shared/schemas/billing";
import type { InvoiceId, OrganizationId, TimeEntryId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import type { InvoiceRepository } from "../repositories/invoice-repository";
import type { MatterRepository } from "../repositories/matter-repository";
import type { TimeEntryRepository } from "../repositories/time-entry-repository";

/** Den smala repo-sömmen regeln använder — inget mer (ISP; testbar med små dubbletter). */
export interface RadgivningRepos {
  invoices: Pick<InvoiceRepository, "listByMatter">;
  matters: Pick<MatterRepository, "getByIdInOrg">;
  timeEntries: Pick<TimeEntryRepository, "getByIdInOrg" | "listByInvoice" | "update" | "create">;
}
type Repos = RadgivningRepos;

/** Ärendets rådgivningsstatus: finns fakturan, och är en post låst mot den? */
export async function loadRadgivningStatus(repos: Repos, matter: Matter): Promise<RadgivningEntryStatus> {
  const invoiceId = findRadgivningInvoiceId(await repos.invoices.listByMatter(matter.id));
  const invoiceEntries = invoiceId === null ? [] : await repos.timeEntries.listByInvoice(invoiceId);
  return radgivningEntryStatus(matter, invoiceId, invoiceEntries);
}

/** Resultatet: den låsta posten + ev. resten som blev kvar som vanlig tid. */
export interface MarkRadgivningResult {
  locked: TimeEntry;
  remainder: TimeEntry | null;
}

function badRequest(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

/** Posten + ärendets rådgivningsfaktura, eller BAD_REQUEST med skälet. */
async function assertMarkable(repos: Repos, orgId: OrganizationId, id: TimeEntryId): Promise<{ entry: TimeEntry; invoiceId: InvoiceId }> {
  const entry = await repos.timeEntries.getByIdInOrg(id, orgId);
  if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
  const entryBlocker = entryMarkBlocker(entry);
  if (entryBlocker) throw badRequest(entryBlocker);
  const matter = await repos.matters.getByIdInOrg(entry.matterId, orgId);
  if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
  const target = markTarget(await loadRadgivningStatus(repos, matter));
  if (!target.ok) throw badRequest(target.reason);
  return { entry, invoiceId: target.invoiceId };
}

/** Resten (minuter över rådgivningstimmen) som en ny, olåst post med samma innehåll. */
function createRemainder(repos: Repos, entry: TimeEntry, minutes: number): Promise<TimeEntry> {
  return repos.timeEntries.create(omitUndefined({
    matterId: entry.matterId, userId: entry.userId, date: entry.date, minutes,
    description: entry.description, hourlyRate: entry.hourlyRate, kind: entry.kind,
    standardAtgardId: entry.standardAtgardId, billable: entry.billable,
  }) satisfies Partial<TimeEntry>);
}

/**
 * Lås posten mot rådgivningsfakturan (`frozenAt` + `invoiceId`, ingen körning —
 * samma form som `invoice.createRadgivning` ger). Över 60 min delas posten:
 * DEN UTPEKADE posten (samma id) blir rådgivningstimmen på exakt 60 min och
 * resten blir en ny olåst post. Id:t följer det juristen pekade ut som mötet,
 * så ≤ 60 och > 60 går samma väg och den låsta posten behåller sin historik.
 */
export async function markEntryAsRadgivning(
  repos: Repos, orgId: OrganizationId, id: TimeEntryId, now: Date,
): Promise<MarkRadgivningResult> {
  const { entry, invoiceId } = await assertMarkable(repos, orgId, id);
  const { locked, rest } = splitRadgivningMinutes(entry.minutes);
  const lockedEntry = await repos.timeEntries.update(entry.id, { minutes: locked, frozenAt: now, invoiceId } satisfies Partial<TimeEntry>);
  const remainder = rest > 0 ? await createRemainder(repos, entry, rest) : null;
  return { locked: lockedEntry, remainder };
}
