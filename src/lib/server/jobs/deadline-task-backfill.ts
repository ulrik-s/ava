/**
 * Frister ur kalendern blir uppgifter (#2121) — en uppstartsfyllning.
 *
 * Innan kalendern togs bort ur gränssnittet kunde en frist registreras som
 * kalenderhändelse (`kind = "deadline"`). Frister och Att bevaka läser bara
 * uppgifter, så de raderna syntes inte. Jobbet ger varje sådan händelse en
 * uppgift, en gång. Kalenderraderna rörs inte (contract-steget tar bort dem,
 * ava-feedback#144).
 *
 * Hur flytten minns: uppgiftens id härleds ur händelsens id
 * (`derivedId(händelse, "deadline-task")`, ADR 0037). Finns id:t i byrån,
 * levande eller mjukraderat, är händelsen flyttad. Inga kalenderrader märks.
 *
 * Förebild: `bad-debt-write-off-backfill.ts`. Skrivningen går via repona, som
 * loggar i `change_log` → klienterna hämtar uppgifterna (ADR 0017). Bara
 * INSERT; ett fel loggas per händelse och stoppar inte resten.
 */

import type { CalendarEvent, Task } from "@/lib/shared/schemas/calendar";
import { asId, type OrganizationId, type TaskId } from "@/lib/shared/schemas/ids";
import { stockholmDay, stockholmDayStart } from "@/lib/shared/stockholm-time";
import { derivedId } from "@/lib/shared/sync/derived-id";
import type { Repositories } from "../repositories/repositories";

/** Rollen i det härledda id:t: händelsens uppgift. */
const TASK_ROLE = "deadline-task";

export interface DeadlineTaskBackfillResult {
  /** Antal skapade uppgifter. */
  tasks: number;
  /**
   * Antal fel, räknat **per händelse** (till skillnad från
   * `backfillBadDebtWriteOffs`, som räknar per byrå). Ett fel som stoppar en
   * hel byrå, t.ex. att listan inte går att läsa, räknas som ett.
   */
  failed: number;
}

/** Uppgiftens id för en händelse: samma vid varje körning. */
function deadlineTaskId(event: Pick<CalendarEvent, "id">): TaskId {
  return asId<"TaskId">(derivedId(event.id, TASK_ROLE));
}

/** Fristens tidpunkt: heldag → den svenska dagens början, annars `startAt`. */
function deadlineDueAt(event: Pick<CalendarEvent, "startAt" | "allDay">): Date {
  const startAt = new Date(event.startAt);
  return event.allDay ? stockholmDayStart(stockholmDay(startAt)) : startAt;
}

/** Uppgiften som en händelse blir. */
function taskFor(event: CalendarEvent): Partial<Task> {
  return {
    id: deadlineTaskId(event),
    organizationId: event.organizationId,
    userId: event.userId,
    title: event.title,
    description: event.description ?? null,
    matterId: event.matterId ?? null,
    status: "TODO",
    priority: "MEDIUM",
    dueAt: deadlineDueAt(event),
    completedAt: null,
  };
}

/** En byrå: flytta händelserna som saknar uppgift, var för sig. */
async function backfillOrganization(
  repos: Repositories, orgId: OrganizationId, result: DeadlineTaskBackfillResult, onError: (message: string) => void,
): Promise<void> {
  const events = await repos.calendarEvents.listDeadlinesForOrg(orgId);
  const existing = await repos.tasks.existingIdsInOrg(events.map(deadlineTaskId), orgId);
  for (const event of events.filter((e) => !existing.has(deadlineTaskId(e)))) {
    try {
      await repos.tasks.create(taskFor(event));
      result.tasks++;
    } catch (err) {
      result.failed++;
      onError(`händelse ${event.id}: ${String(err)}`);
    }
  }
}

/** Ge byråernas frister i kalendern var sin uppgift. Kastar aldrig. */
export async function backfillDeadlineTasks(
  repos: Repositories, organizationIds: readonly OrganizationId[], onError: (message: string) => void,
): Promise<DeadlineTaskBackfillResult> {
  const result: DeadlineTaskBackfillResult = { tasks: 0, failed: 0 };
  for (const id of organizationIds) {
    try {
      await backfillOrganization(repos, id, result, onError);
    } catch (err) {
      result.failed++;
      onError(`byrå ${id}: ${String(err)}`);
    }
  }
  return result;
}
