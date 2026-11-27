/**
 * Flytta tidsposter till ett annat ärende (#2042), utbrutet ur routern (#2176).
 * Körs i anroparens transaktion; tar repona explicit.
 */
import { TRPCError } from "@trpc/server";
import type { TimeEntry } from "@/lib/shared/schemas/billing";
import type { MatterId, OrganizationId, TimeEntryId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";
import { assertEditable, rateFor, type EntryRateRepos } from "./entry-rules";

/** Repona flytten läser och skriver. */
export type MoveEntriesRepos = EntryRateRepos & Pick<Repositories, "timeEntries">;

/**
 * Posterna som ska flyttas, var och en i byrån och olåst — annars vägras hela
 * anropet. Repot har ingen batchläsning per id inom byrån, så det blir en
 * läsning per post (högst 500, routerns indatagräns).
 */
async function loadMovable(repos: MoveEntriesRepos, orgId: OrganizationId, ids: TimeEntryId[]): Promise<TimeEntry[]> {
  const entries = await Promise.all(ids.map((id) => repos.timeEntries.getByIdInOrg(id, orgId)));
  return entries.map((entry) => {
    if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
    assertEditable(entry);
    return entry;
  });
}

/**
 * Flyttar posterna till `matterId` (#2042) med målärendets á-pris, som om de
 * registrerats där. Alla prövas innan någon skrivs (allt eller inget). En post
 * som redan ligger i målärendet lämnas orörd. Ger posterna som flyttades, som
 * de såg ut före flytten (deras `matterId` är ärendet de kom från).
 */
export async function moveEntries(
  repos: MoveEntriesRepos, orgId: OrganizationId, ids: TimeEntryId[], matterId: MatterId,
): Promise<TimeEntry[]> {
  const moving = (await loadMovable(repos, orgId, ids)).filter((entry) => entry.matterId !== matterId);
  for (const entry of moving) {
    const hourlyRate = await rateFor(repos, orgId, entry, { kind: entry.kind, matterId });
    await repos.timeEntries.update(entry.id, { matterId, hourlyRate });
  }
  return moving;
}
