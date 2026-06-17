/**
 * `TaskRepository` (ADR 0020, #409 fan-out) — uppgifter (todo med valfri due-date).
 * Tasks är PER-USER (ägare = userId) inom org:en. Bas-CRUD ärvs; `listForUser`
 * ger den ägar-/org-scopade listan med ärende-subset och `getOwned` är
 * ägarskaps-vakten (id + userId + organizationId).
 */

import type { Task } from "@/lib/shared/schemas/calendar";
import type { Repository } from "./types";

/** Task + ärende-subsetet listvyn visar. */
export interface TaskListRow extends Task {
  matter: { id: string; matterNumber: string; title: string } | null;
}

/** Filter för `listForUser`. */
export interface TaskListFilter {
  status?: string | undefined;
  matterId?: string | undefined;
}

export interface TaskRepository extends Repository<Task> {
  /** Användarens uppgifter i org:en (dueAt asc), med ärende-subset. */
  listForUser(userId: string, organizationId: string, filter: TaskListFilter): Promise<TaskListRow[]>;
  /** Uppgift by id, ägar-scopad (id + userId + org). Null om saknas/ej ägd/raderad. */
  getOwned(id: string, userId: string, organizationId: string): Promise<Task | null>;
}
