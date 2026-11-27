/**
 * Tidsrapporten per jurist (`timeEntry.report`), utbruten ur routern (#2176).
 * Läser via repot (ADR 0020): `listForReport` ger jurist + ärende inkl.
 * KLIENT-kontakt; här grupperas raderna per jurist.
 */
import type { OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";
import type { TimeEntryReportFilter, TimeEntryReportRow } from "../repositories/time-entry-repository";

/** En jurists del av rapporten. */
export interface UserTimeReport {
  name: string;
  totalMinutes: number;
  billableMinutes: number;
  entries: TimeEntryReportRow[];
}

/** Rapporten: juristens id → hens poster och summor, plus antalet poster. */
export interface TimeReport {
  byUser: Record<string, UserTimeReport>;
  totalEntries: number;
}

/** Gruppera rapportraderna per jurist, i radernas ordning. */
export function groupByUser(entries: readonly TimeEntryReportRow[]): TimeReport {
  const byUser: Record<string, UserTimeReport> = {};
  for (const entry of entries) {
    const bucket = byUser[entry.userId] ??= {
      name: entry.user.name, totalMinutes: 0, billableMinutes: 0, entries: [],
    };
    bucket.totalMinutes += entry.minutes;
    if (entry.billable) bucket.billableMinutes += entry.minutes;
    bucket.entries.push(entry);
  }
  return { byUser, totalEntries: entries.length };
}

/** Hämta byråns poster enligt filtret och gruppera dem per jurist. */
export async function loadTimeReport(
  repos: Pick<Repositories, "timeEntries">, org: OrganizationId, filter: TimeEntryReportFilter,
): Promise<TimeReport> {
  return groupByUser(await repos.timeEntries.listForReport(org, filter));
}
