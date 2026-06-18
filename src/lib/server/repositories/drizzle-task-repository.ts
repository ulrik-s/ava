/**
 * Drizzle `TaskRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `listForUser` left-joinar matter (nullable FK), `getOwned` ägar-scopar.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import type { Task } from "@/lib/shared/schemas/calendar";
import { matters, tasks } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { TaskListFilter, TaskListRow, TaskRepository } from "./task-repository";

export class DrizzleTaskRepository extends DrizzleRepository<Task> implements TaskRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(tasks), now);
  }

  async listForUser(userId: string, organizationId: string, filter: TaskListFilter): Promise<TaskListRow[]> {
    const rows = await this.db
      .select({
        t: tasks,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title,
      })
      .from(tasks)
      .leftJoin(matters, eq(tasks.matterId, matters.id))
      .where(and(
        eq(tasks.userId, userId),
        eq(tasks.organizationId, organizationId),
        isNull(tasks.deletedAt),
        filter.status ? eq(tasks.status, filter.status) : undefined,
        filter.matterId ? eq(tasks.matterId, filter.matterId) : undefined,
      ))
      .orderBy(asc(tasks.dueAt));
    return rows.map((r) => ({
      ...(r.t as object),
      matter: r.mId ? { id: r.mId, matterNumber: r.mNum as string, title: r.mTitle as string } : null,
    })) as unknown as TaskListRow[];
  }

  async getOwned(id: string, userId: string, organizationId: string): Promise<Task | null> {
    const rows = await this.db
      .select().from(tasks)
      .where(and(
        eq(tasks.id, id), eq(tasks.userId, userId), eq(tasks.organizationId, organizationId), isNull(tasks.deletedAt),
      )).limit(1);
    return (rows[0] as unknown as Task | undefined) ?? null;
  }
}
