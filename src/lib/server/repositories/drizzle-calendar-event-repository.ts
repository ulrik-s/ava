/**
 * Drizzle `CalendarEventRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * list/detalj left-joinar matter (nullable FK).
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { CalendarEvent } from "@/lib/shared/schemas/calendar";
import { calendarEvents, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import type { CalendarEventRepository, CalendarEventRow } from "./calendar-event-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";

type MatterCols = { mId: string | null; mNum: string | null; mTitle: string | null };

function withMatter<T extends MatterCols & { ev: unknown }>(r: T): CalendarEventRow {
  return {
    ...(r.ev as object),
    matter: r.mId ? { id: r.mId, matterNumber: r.mNum as string, title: r.mTitle as string } : null,
  } as unknown as CalendarEventRow;
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

  async listForUser(userId: string, organizationId: string): Promise<CalendarEventRow[]> {
    const rows = await this.db
      .select(this.matterSelect()).from(calendarEvents)
      .leftJoin(matters, eq(calendarEvents.matterId, matters.id))
      .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.organizationId, organizationId), isNull(calendarEvents.deletedAt)))
      .orderBy(asc(calendarEvents.startAt));
    return rows.map(withMatter);
  }

  async listForUsers(userIds: string[], organizationId: string): Promise<CalendarEventRow[]> {
    if (!userIds.length) return [];
    const rows = await this.db
      .select(this.matterSelect()).from(calendarEvents)
      .leftJoin(matters, eq(calendarEvents.matterId, matters.id))
      .where(and(eq(calendarEvents.organizationId, organizationId), inArray(calendarEvents.userId, userIds), isNull(calendarEvents.deletedAt)))
      .orderBy(asc(calendarEvents.startAt));
    return rows.map(withMatter);
  }

  async listForMatter(matterId: string, organizationId: string): Promise<CalendarEvent[]> {
    const rows = await this.db
      .select().from(calendarEvents)
      .where(and(eq(calendarEvents.matterId, matterId), eq(calendarEvents.organizationId, organizationId), isNull(calendarEvents.deletedAt)))
      .orderBy(asc(calendarEvents.startAt));
    return rows as unknown as CalendarEvent[];
  }

  async getOwned(id: string, userId: string, organizationId: string): Promise<CalendarEvent | null> {
    const rows = await this.db
      .select().from(calendarEvents)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId), eq(calendarEvents.organizationId, organizationId), isNull(calendarEvents.deletedAt)))
      .limit(1);
    return (rows[0] as unknown as CalendarEvent | undefined) ?? null;
  }

  async getOwnedWithMatter(id: string, userId: string, organizationId: string): Promise<CalendarEventRow | null> {
    const rows = await this.db
      .select(this.matterSelect()).from(calendarEvents)
      .leftJoin(matters, eq(calendarEvents.matterId, matters.id))
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId), eq(calendarEvents.organizationId, organizationId), isNull(calendarEvents.deletedAt)))
      .limit(1);
    return rows[0] ? withMatter(rows[0]) : null;
  }
}
