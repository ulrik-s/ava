/**
 * Drizzle `CalendarEventRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * list/detalj left-joinar matter (nullable FK).
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { CalendarEvent } from "@/lib/shared/schemas/calendar";
import type { CalendarEventId, MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import { calendarEvents, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import type { CalendarEventRepository, CalendarEventRow } from "./calendar-event-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";

type MatterCols = { mId: MatterId | null; mNum: string | null; mTitle: string | null };

function withMatter(r: MatterCols & { ev: typeof calendarEvents.$inferSelect }): CalendarEventRow {
  return {
    ...r.ev,
    matter: r.mId ? { id: r.mId, matterNumber: r.mNum ?? "", title: r.mTitle ?? "" } : null,
  };
}

export class DrizzleCalendarEventRepository extends DrizzleRepository<CalendarEvent> implements CalendarEventRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(calendarEvents), now);
  }

  private matterSelect() {
    return {
      ev: calendarEvents,
      mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title,
    };
  }

  async listForUser(userId: UserId, organizationId: OrganizationId): Promise<CalendarEventRow[]> {
    const rows = await this.db
      .select(this.matterSelect()).from(calendarEvents)
      .leftJoin(matters, eq(calendarEvents.matterId, matters.id))
      .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.organizationId, organizationId), isNull(calendarEvents.deletedAt)))
      .orderBy(asc(calendarEvents.startAt));
    return rows.map(withMatter);
  }

  async listForUsers(userIds: UserId[], organizationId: OrganizationId): Promise<CalendarEventRow[]> {
    if (!userIds.length) return [];
    const rows = await this.db
      .select(this.matterSelect()).from(calendarEvents)
      .leftJoin(matters, eq(calendarEvents.matterId, matters.id))
      .where(and(eq(calendarEvents.organizationId, organizationId), inArray(calendarEvents.userId, userIds), isNull(calendarEvents.deletedAt)))
      .orderBy(asc(calendarEvents.startAt));
    return rows.map(withMatter);
  }

  async listForMatter(matterId: MatterId, organizationId: OrganizationId): Promise<CalendarEvent[]> {
    const rows = await this.db
      .select().from(calendarEvents)
      .where(and(eq(calendarEvents.matterId, matterId), eq(calendarEvents.organizationId, organizationId), isNull(calendarEvents.deletedAt)))
      .orderBy(asc(calendarEvents.startAt));
    return rows;
  }

  async getOwned(id: CalendarEventId, userId: UserId, organizationId: OrganizationId): Promise<CalendarEvent | null> {
    const rows = await this.db
      .select().from(calendarEvents)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId), eq(calendarEvents.organizationId, organizationId), isNull(calendarEvents.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getOwnedWithMatter(id: CalendarEventId, userId: UserId, organizationId: OrganizationId): Promise<CalendarEventRow | null> {
    const rows = await this.db
      .select(this.matterSelect()).from(calendarEvents)
      .leftJoin(matters, eq(calendarEvents.matterId, matters.id))
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId), eq(calendarEvents.organizationId, organizationId), isNull(calendarEvents.deletedAt)))
      .limit(1);
    return rows[0] ? withMatter(rows[0]) : null;
  }
}
