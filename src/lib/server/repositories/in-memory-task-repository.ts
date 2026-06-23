/**
 * In-memory `TaskRepository` (ADR 0020) — browser/offline-impl. Ärver bas-CRUD;
 * list/ägar-vakt använder samma where/include som routern.
 */

import type { Task } from "@/lib/shared/schemas/calendar";
import type { OrganizationId, TaskId, UserId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { TaskListFilter, TaskListRow, TaskRepository } from "./task-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type TaskRepoSource = Pick<IDataStore, "tasks">;

export class InMemoryTaskRepository extends InMemoryRepository<Task> implements TaskRepository {
  constructor(store: TaskRepoSource, now?: () => Date) {
    super(store.tasks, now ?? (() => new Date()));
  }

  async listForUser(userId: UserId, organizationId: OrganizationId, filter: TaskListFilter): Promise<TaskListRow[]> {
    return (await this.delegate.findMany({
      where: {
        userId,
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.matterId ? { matterId: filter.matterId } : {}),
      },
      orderBy: { dueAt: "asc" },
      include: { matter: { select: { id: true, matterNumber: true, title: true } } },
    })) as TaskListRow[];
  }

  async getOwned(id: TaskId, userId: UserId, organizationId: OrganizationId): Promise<Task | null> {
    const row = (await this.delegate.findFirst({ where: { id, userId, organizationId } })) as Task | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }
}
