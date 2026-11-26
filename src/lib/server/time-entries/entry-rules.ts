/**
 * Tidspostens regler som routern och flytten delar (#2176): låsregeln,
 * minutregeln och á-priset när posten skapas eller byter kategori eller
 * ärende. Tar repona explicit, så reglerna är testbara utan en tRPC-kontext.
 */
import { TRPCError } from "@trpc/server";
import { isPerDayKind } from "@/lib/shared/brottmalstaxa";
import type { TimeEntry } from "@/lib/shared/schemas/billing";
import type { TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import { isLockedEntry, type LockableEntry } from "@/lib/shared/time-entry-lock";
import { entryRateOre, type RateSubject } from "../billing/time-entry-rate";
import type { Repositories } from "../repositories/repositories";

/** Repona á-priset läser: postens jurist, ärendet och byrån. */
export type EntryRateRepos = Pick<Repositories, "users" | "matters" | "organizations">;

/**
 * En låst post (`isLockedEntry`: fakturerad eller fryst av en slutfaktura eller
 * kostnadsräkning, #1862/#1863) får varken ändras eller tas bort: det fakturerade
 * eller till domstolen redovisade underlaget hade annars inte längre stämt med
 * posterna. Samma regel och lydelse som utläggsroutern. Aconto låser inte — de
 * posterna är fortfarande redigerbara.
 */
export function assertEditable(entry: LockableEntry): void {
  if (isLockedEntry(entry)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Tidposten ingår i en faktura eller kostnadsräkning och kan inte ändras eller tas bort.",
    });
  }
}

/** Vad `minutes`-regeln behöver veta om posten. */
interface EntryShape {
  minutes?: number | undefined;
  kind?: TimeEntryKind | null | undefined;
  date?: string | undefined;
}

/**
 * Noll minuter är bara meningsfullt för per-dygns-kategorier (#950). Zod kan
 * inte uttrycka beroendet mellan två fält lika läsbart som en guard, och
 * felmeddelandet ska säga VILKEN kategori som gäller — inte bara "≥ 1".
 */
export function assertMinutes(input: EntryShape): void {
  if ((input.minutes ?? 0) > 0 || isPerDayKind(input.kind)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Tidsposten måste ha minst en minut. Noll minuter används bara för advokatberedskap, som ersätts per dag.",
  });
}

/** Á-priset en ny post får: ett explicit á-pris (setup-väg) vinner, utom för beredskap. */
export function rateOnCreate(
  repos: EntryRateRepos, orgId: OrganizationId, entry: RateSubject, explicitRate: number | undefined,
): Promise<number> {
  return explicitRate !== undefined && !isPerDayKind(entry.kind)
    ? Promise.resolve(explicitRate)
    : entryRateOre(repos, orgId, entry);
}

/** Postens á-pris med en ny kategori eller ett nytt ärende, med postens jurists priser. */
export async function rateFor(
  repos: EntryRateRepos, orgId: OrganizationId, owned: TimeEntry,
  change: { kind: TimeEntryKind | null | undefined; matterId: MatterId },
): Promise<number> {
  const user = await repos.users.getByIdInOrg(owned.userId, orgId);
  return entryRateOre(repos, orgId, { kind: change.kind, date: owned.date, matterId: change.matterId, userRates: user?.hourlyRates });
}

/**
 * Nytt á-pris när kategorin byts (#1206) — en post som går från timarvode till
 * tidsspillan ska debiteras som tidsspillan. Oförändrad eller utelämnad
 * kategori rör inte priset (en prisändring på byrå/jurist/ärende gäller bara ny tid).
 */
export async function rateOnKindChange(
  repos: EntryRateRepos, orgId: OrganizationId, owned: TimeEntry, kind: TimeEntryKind | undefined,
): Promise<number | undefined> {
  if (kind === undefined || kind === (owned.kind ?? "ARBETE")) return undefined;
  return rateFor(repos, orgId, owned, { kind, matterId: owned.matterId });
}
