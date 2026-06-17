/**
 * `TimeEntryRepository` (ADR 0020, #409 fan-out) — tidsposter. Bas-CRUD ärvs;
 * `listUnbilled` hämtar valda ofakturerade poster (med juristens timtaxa för
 * fakturaberäkningen) och `flagBilled` kopplar dem till fakturan (bulk).
 */

import type { TimeEntry } from "@/lib/shared/schemas/billing";
import type { Repository } from "./types";

/** Tidspost + juristens timtaxa (det fakturaberäkningen behöver). */
export interface UnbilledTimeEntry extends TimeEntry {
  user: { hourlyRate: number | null };
}

/** Tidspost + relationer för listvyn. matter alltid satt (matterId NOT NULL FK). */
export interface TimeEntryListRow extends TimeEntry {
  user: { id: string; name: string } | null;
  matter: { id: string; matterNumber: string; title: string };
  invoice: { id: string; invoiceNumber: string | null } | null;
}

export interface TimeEntryListFilter {
  matterId?: string | undefined;
  userId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  page: number;
  pageSize: number;
}

export interface TimeEntryListResult {
  entries: TimeEntryListRow[];
  total: number;
  totalMinutes: number;
}

/** Tidspost för tidsrapporten — med jurist + ärende inkl. klient-kontakten (KLIENT). */
export interface TimeEntryReportRow extends TimeEntry {
  user: { id: string; name: string };
  matter: { id: string; matterNumber: string; title: string; contacts: Array<{ contact: { name: string } }> } | null;
}

export interface TimeEntryReportFilter {
  from: Date;
  to: Date;
  userId?: string | undefined;
  userIds?: string[] | undefined;
  matterId?: string | undefined;
}

export interface TimeEntryRepository extends Repository<TimeEntry> {
  /** Org-scopad paginerad lista (datum desc) + total + summa minuter. */
  listForOrg(organizationId: string, filter: TimeEntryListFilter): Promise<TimeEntryListResult>;
  /** Tidspost by id, org-scopad via ärendet (null om saknas/annan org/raderad). */
  getByIdInOrg(id: string, organizationId: string): Promise<TimeEntry | null>;
  /** Tidsrapport-rader (jurist + ärende + KLIENT-kontakt), org-scopat, userId asc / date asc. */
  listForReport(organizationId: string, filter: TimeEntryReportFilter): Promise<TimeEntryReportRow[]>;
  /** Valda ofakturerade tidsposter i ett ärende (med user.hourlyRate). Tom lista vid tomma ids. */
  listUnbilled(matterId: string, ids: string[]): Promise<UnbilledTimeEntry[]>;
  /** Koppla tidsposter till en faktura (sätter invoiceId). No-op vid tomma ids. */
  flagBilled(ids: string[], invoiceId: string): Promise<void>;
}
