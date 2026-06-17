/**
 * `CalendarEventRepository` (ADR 0020, #409 fan-out) — kalenderhändelser.
 * Events är per-user inom org:en. Bas-CRUD ärvs. Tids-/visibility-filter görs
 * i routern (in-memory query-engine stödjer inte Date-range); repot levererar
 * den org-/ägar-scopade listan med ärende-subset.
 */

import type { CalendarEvent } from "@/lib/shared/schemas/calendar";
import type { Repository } from "./types";

/** Händelse + ärende-subsetet vyerna visar. */
export interface CalendarEventRow extends CalendarEvent {
  matter: { id: string; matterNumber: string; title: string } | null;
}

export interface CalendarEventRepository extends Repository<CalendarEvent> {
  /** Den aktiva användarens händelser (startAt asc), med ärende-subset. */
  listForUser(userId: string, organizationId: string): Promise<CalendarEventRow[]>;
  /** Flera användares händelser (multi-user-vy), org-scopat, med ärende-subset. */
  listForUsers(userIds: string[], organizationId: string): Promise<CalendarEventRow[]>;
  /** Alla händelser för ett ärende, kronologiskt (utan ärende-subset). */
  listForMatter(matterId: string, organizationId: string): Promise<CalendarEvent[]>;
  /** Händelse by id, ägar-scopad (id + userId + org). Null om saknas/ej ägd/raderad. */
  getOwned(id: string, userId: string, organizationId: string): Promise<CalendarEvent | null>;
  /** Som `getOwned` men med ärende-subset (detaljvyn). */
  getOwnedWithMatter(id: string, userId: string, organizationId: string): Promise<CalendarEventRow | null>;
}
