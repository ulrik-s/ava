/**
 * In-memory `CalendarEventRepository` (ADR 0020) — browser/offline-impl.
 * Ärver bas-CRUD; list/ägar-vakt använder samma where/include som routern.
 */

import type { CalendarEvent } from "@/lib/shared/schemas/calendar";
import type { CalendarEventId, MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import type { CalendarEventRepository, CalendarEventRow } from "./calendar-event-repository";
import { InMemoryRepository } from "./in-memory-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type CalendarEventRepoSource = Pick<IDataStore, "calendarEvents">;

const MATTER_INCLUDE = { matter: { select: { id: true, matterNumber: true, title: true } } };

export class InMemoryCalendarEventRepository extends InMemoryRepository<CalendarEvent> implements CalendarEventRepository {
  constructor(store: CalendarEventRepoSource, now?: () => Date) {
    super(store.calendarEvents, now ?? (() => new Date()));
  }

  async listForUser(userId: UserId, organizationId: OrganizationId): Promise<CalendarEventRow[]> {
    return (await this.delegate.findMany({
      where: { userId, organizationId },
      orderBy: { startAt: "asc" },
      include: MATTER_INCLUDE,
    })) as CalendarEventRow[];
  }

  async listForUsers(userIds: UserId[], organizationId: OrganizationId): Promise<CalendarEventRow[]> {
    return (await this.delegate.findMany({
      where: { organizationId, userId: { in: userIds } },
      orderBy: { startAt: "asc" },
      include: MATTER_INCLUDE,
    })) as CalendarEventRow[];
  }

  async listForMatter(matterId: MatterId, organizationId: OrganizationId): Promise<CalendarEvent[]> {
    return (await this.delegate.findMany({
      where: { matterId, organizationId },
      orderBy: { startAt: "asc" },
    })) as CalendarEvent[];
  }

  async getOwned(id: CalendarEventId, userId: UserId, organizationId: OrganizationId): Promise<CalendarEvent | null> {
    const row = (await this.delegate.findFirst({ where: { id, userId, organizationId } })) as CalendarEvent | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async getOwnedWithMatter(id: CalendarEventId, userId: UserId, organizationId: OrganizationId): Promise<CalendarEventRow | null> {
    const row = (await this.delegate.findFirst({
      where: { id, userId, organizationId },
      include: MATTER_INCLUDE,
    })) as CalendarEventRow | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }
}
