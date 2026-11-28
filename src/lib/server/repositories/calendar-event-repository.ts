/**
 * `CalendarEventRepository` (ADR 0020, #409 fan-out) — kalenderhändelser.
 * Events är per-user inom org:en. Bas-CRUD ärvs. Tids-/visibility-filter görs
 * i routern (in-memory query-engine stödjer inte Date-range); repot levererar
 * den org-/ägar-scopade listan med ärende-subset.
 */

import type { CalendarEvent } from "@/lib/shared/schemas/calendar";
import type { CalendarEventId, MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

/** Händelse + ärende-subsetet vyerna visar. */
export interface CalendarEventRow extends CalendarEvent {
  matter: { id: MatterId; matterNumber: string; title: string } | null;
}

export interface CalendarEventRepository extends Repository<CalendarEvent> {
  /** Den aktiva användarens händelser (startAt asc), med ärende-subset. */
  listForUser(userId: UserId, organizationId: OrganizationId): Promise<CalendarEventRow[]>;
  /** Flera användares händelser (multi-user-vy), org-scopat, med ärende-subset. */
  listForUsers(userIds: UserId[], organizationId: OrganizationId): Promise<CalendarEventRow[]>;
  /** Alla händelser för ett ärende, kronologiskt (utan ärende-subset). */
  listForMatter(matterId: MatterId, organizationId: OrganizationId): Promise<CalendarEvent[]>;
  /** Händelse by id, ägar-scopad (id + userId + org). Null om saknas/ej ägd/raderad. */
  getOwned(id: CalendarEventId, userId: UserId, organizationId: OrganizationId): Promise<CalendarEvent | null>;
  /** Som `getOwned` men med ärende-subset (detaljvyn). */
  getOwnedWithMatter(id: CalendarEventId, userId: UserId, organizationId: OrganizationId): Promise<CalendarEventRow | null>;
}
