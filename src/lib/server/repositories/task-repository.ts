/**
 * `TaskRepository` (ADR 0020, #409 fan-out) — uppgifter (todo med valfri due-date).
 * Tasks är PER-USER (ägare = userId) inom org:en. Bas-CRUD ärvs; `listForUser`
 * ger den ägar-/org-scopade listan med ärende-subset och `getByIdInOrg` är
 * org-vakten (id + organizationId) — alla på byrån får ändra, bocka av och
 * radera en bevakning (#1231), inte bara den som lade in den.
 */

import type { Task, TaskStatus } from "@/lib/shared/schemas/calendar";
import type { MatterId, OrganizationId, TaskId, UserId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

/** Task + ärende-subsetet listvyn visar. */
export interface TaskListRow extends Task {
  matter: { id: MatterId; matterNumber: string; title: string } | null;
}

/** Filter för `listForUser`. */
export interface TaskListFilter {
  status?: TaskStatus | undefined;
  matterId?: MatterId | undefined;
}

export interface TaskRepository extends Repository<Task> {
  /** Användarens uppgifter i org:en (dueAt asc), med ärende-subset. */
  listForUser(userId: UserId, organizationId: OrganizationId, filter: TaskListFilter): Promise<TaskListRow[]>;
  /**
   * Ärendets uppgifter (frister) i org:en — ALLA användares (dueAt asc). En
   * frist i ett ärende angår alla som arbetar i det, inte bara den som lade in
   * den. Ändra/klarmarkera/radera är org-scopat (`getByIdInOrg`, #1231).
   */
  listForMatter(matterId: MatterId, organizationId: OrganizationId): Promise<TaskListRow[]>;
  /** Uppgift by id i org:en (vem som helst på byrån). Null om saknas/annan byrå/raderad. */
  getByIdInOrg(id: TaskId, organizationId: OrganizationId): Promise<Task | null>;
}
