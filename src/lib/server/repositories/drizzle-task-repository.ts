/**
 * Drizzle `TaskRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `listForUser` left-joinar matter (nullable FK), `getOwned` ägar-scopar.
 */

import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import type { Task } from "@/lib/shared/schemas/calendar";
import type { MatterId, OrganizationId, TaskId, UserId } from "@/lib/shared/schemas/ids";
import { matters, tasks } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { TaskListFilter, TaskListRow, TaskRepository } from "./task-repository";

export class DrizzleTaskRepository extends DrizzleRepository<Task> implements TaskRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(tasks), now);
  }

  async listForUser(userId: UserId, organizationId: OrganizationId, filter: TaskListFilter): Promise<TaskListRow[]> {
    return this.list(and(
      eq(tasks.userId, userId),
      eq(tasks.organizationId, organizationId),
      filter.status ? eq(tasks.status, filter.status) : undefined,
      filter.matterId ? eq(tasks.matterId, filter.matterId) : undefined,
    ));
  }

  async listForMatter(matterId: MatterId, organizationId: OrganizationId): Promise<TaskListRow[]> {
    return this.list(and(eq(tasks.matterId, matterId), eq(tasks.organizationId, organizationId)));
  }

  /** Uppgifter (ej raderade) med ärende-subset, dueAt asc. */
  private async list(where: SQL | undefined): Promise<TaskListRow[]> {
    const rows = await this.db
      .select({
        t: tasks,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title,
      })
      .from(tasks)
      .leftJoin(matters, eq(tasks.matterId, matters.id))
      .where(and(isNull(tasks.deletedAt), where))
      .orderBy(asc(tasks.dueAt));
    return rows.map((r): TaskListRow => ({
      ...r.t,
      matter: r.mId ? { id: r.mId, matterNumber: r.mNum ?? "", title: r.mTitle ?? "" } : null,
    }));
  }

  async getOwned(id: TaskId, userId: UserId, organizationId: OrganizationId): Promise<Task | null> {
    const rows = await this.db
      .select().from(tasks)
      .where(and(
        eq(tasks.id, id), eq(tasks.userId, userId),
        eq(tasks.organizationId, organizationId), isNull(tasks.deletedAt),
      )).limit(1);
    return rows[0] ?? null;
  }
}
