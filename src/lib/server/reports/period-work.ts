/**
 * Periodens arbete (tid och utlägg) för en jurist eller hela byrån (#2113).
 * Ett ställe för rapporternas hämtning. Läser bara via repona (ADR 0020);
 * hela byrån är summan per jurist, som `firmOverview`.
 */
import type { ReportSubject } from "@/lib/shared/report-subject";
import type { OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { LawyerReportExpense } from "../repositories/expense-repository";
import type { Repositories } from "../repositories/repositories";
import type { LawyerReportTimeEntry } from "../repositories/time-entry-repository";

/** Periodens tidsposter och utlägg, sorterade på datum (stigande). */
export interface PeriodWork {
  timeEntries: LawyerReportTimeEntry[];
  expenses: LawyerReportExpense[];
}

type PeriodRepos = Pick<Repositories, "timeEntries" | "expenses" | "users">;

async function lawyerWork(repos: PeriodRepos, org: OrganizationId, userId: UserId, from: Date, to: Date): Promise<PeriodWork> {
  const [timeEntries, expenses] = await Promise.all([
    repos.timeEntries.listForLawyerInPeriod(org, userId, from, to),
    repos.expenses.listForLawyerInPeriod(org, userId, from, to),
  ]);
  return { timeEntries, expenses };
}

function byDate(a: { date: Date | string }, b: { date: Date | string }): number {
  return new Date(a.date).getTime() - new Date(b.date).getTime();
}

async function firmWork(repos: PeriodRepos, org: OrganizationId, from: Date, to: Date): Promise<PeriodWork> {
  const users = await repos.users.listByOrg(org);
  const perUser = await Promise.all(users.map((u) => lawyerWork(repos, org, u.id, from, to)));
  return {
    timeEntries: perUser.flatMap((w) => w.timeEntries).sort(byDate),
    expenses: perUser.flatMap((w) => w.expenses).sort(byDate),
  };
}

/**
 * Hämta periodens arbete för `subject`: en jurists poster exakt som
 * `listForLawyerInPeriod`, eller alla byråns användares poster sammanslagna
 * och sorterade på datum (repometodens kontrakt).
 */
export function loadPeriodWork(
  repos: PeriodRepos,
  org: OrganizationId,
  subject: ReportSubject,
  from: Date,
  to: Date,
): Promise<PeriodWork> {
  return subject.kind === "lawyer"
    ? lawyerWork(repos, org, subject.userId, from, to)
    : firmWork(repos, org, from, to);
}
