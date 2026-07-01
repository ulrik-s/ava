/**
 * `TimeEntryRepository` (ADR 0020, #409 fan-out) — tidsposter. Bas-CRUD ärvs;
 * `listUnbilled` hämtar valda ofakturerade poster (med juristens timtaxa för
 * fakturaberäkningen) och `flagBilled` kopplar dem till fakturan (bulk).
 */

import type { TimeEntry } from "@/lib/shared/schemas/billing";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { BillingRunId, InvoiceId, MatterId, OrganizationId, TimeEntryId, UserId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

/** Tidspost + juristens timtaxa (det fakturaberäkningen behöver). */
export interface UnbilledTimeEntry extends TimeEntry {
  user: { hourlyRate: number | null };
}

/** Tidspost + relationer för listvyn. matter alltid satt (matterId NOT NULL FK). */
export interface TimeEntryListRow extends TimeEntry {
  user: { id: UserId; name: string } | null;
  matter: { id: MatterId; matterNumber: string; title: string };
  invoice: { id: InvoiceId; invoiceNumber: string | null } | null;
}

export interface TimeEntryListFilter {
  matterId?: MatterId | undefined;
  userId?: UserId | undefined;
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

/** Upparbetat (debiterbart) i ett ärende — underlag för täcknings-tak (#793). */
export interface CoverageUsage {
  /** Summa debiterbara minuter (rättshjälpens 100-tim-tak). */
  billableMinutes: number;
  /** Summa debiterbart arvode-värde i öre, exkl moms (rättsskyddets belopps-tak). */
  billableValueOre: number;
}

/** Tidspost för tidsrapporten — med jurist + ärende inkl. klient-kontakten (KLIENT). */
export interface TimeEntryReportRow extends TimeEntry {
  user: { id: UserId; name: string };
  matter: { id: MatterId; matterNumber: string; title: string; contacts: Array<{ contact: { name: string } }> } | null;
}

export interface TimeEntryReportFilter {
  from: Date;
  to: Date;
  userId?: UserId | undefined;
  userIds?: UserId[] | undefined;
  matterId?: MatterId | undefined;
}

/** Ärende-projektionen advokatrapporten (reports.perLawyer) läser. */
export interface ReportMatterRef {
  id: MatterId;
  matterNumber: string;
  title: string;
  paymentMethod: PaymentMethod;
  paymentMethodNote: string | null;
  paymentMethodDecidedAt: Date | null;
  contacts: Array<{ contact: { name: string } }>;
}

/** Tidspost för advokatrapporten — med ärende-ref (KLIENT + betalsätt). */
export interface LawyerReportTimeEntry extends TimeEntry {
  matter: ReportMatterRef | null;
}

export interface TimeEntryRepository extends Repository<TimeEntry> {
  /** Org-scopad paginerad lista (datum desc) + total + summa minuter. */
  listForOrg(organizationId: OrganizationId, filter: TimeEntryListFilter): Promise<TimeEntryListResult>;
  /** Tidspost by id, org-scopad via ärendet (null om saknas/annan org/raderad). */
  getByIdInOrg(id: TimeEntryId, organizationId: OrganizationId): Promise<TimeEntry | null>;
  /** Tidsrapport-rader (jurist + ärende + KLIENT-kontakt), org-scopat, userId asc / date asc. */
  listForReport(organizationId: OrganizationId, filter: TimeEntryReportFilter): Promise<TimeEntryReportRow[]>;
  /** Valda ofakturerade tidsposter i ett ärende (med user.hourlyRate). Tom lista vid tomma ids. */
  listUnbilled(matterId: MatterId, ids: TimeEntryId[]): Promise<UnbilledTimeEntry[]>;
  /** Koppla tidsposter till en faktura (sätter invoiceId). No-op vid tomma ids. */
  flagBilled(ids: TimeEntryId[], invoiceId: InvoiceId): Promise<void>;
  /** Tidsposter kopplade till en faktura (date asc) — fakturaspecifikationen (#856). */
  listByInvoice(invoiceId: InvoiceId): Promise<TimeEntry[]>;
  /** Ofrysta tidsposter i ett ärende (date asc) — underlag för billing-run. */
  listUnfrozenForMatter(matterId: MatterId): Promise<TimeEntry[]>;
  /** Tidsposter frysta mot en specifik billing-run (date asc) — underlag för
   *  dom/slutreglering av en kostnadsräkning, vars rader frystes vid inskick. */
  listByBillingRun(billingRunId: BillingRunId): Promise<TimeEntry[]>;
  /** Summa debiterbara minuter + arvode-värde (öre) i ett ärende — täcknings-tak (#793). */
  coverageUsageForMatter(matterId: MatterId): Promise<CoverageUsage>;
  /** Som ovan men batchat för flera ärenden (täcknings-kolumn i listan, #793).
   *  Keyas på matterId; ärenden utan poster utelämnas (→ 0 hos anroparen). */
  coverageUsageForMatters(matterIds: MatterId[]): Promise<Record<string, CoverageUsage>>;
  /** Frys alla ofrysta tidsposter i ett ärende mot en billing-run (bulk). */
  freezeForMatter(matterId: MatterId, billingRunId: BillingRunId, now: Date): Promise<void>;
  /** Frys ENBART de angivna (ofrysta) tidsposterna mot en billing-run — per-post-val. */
  freezeByIds(ids: TimeEntryId[], billingRunId: BillingRunId, now: Date): Promise<void>;
  /** En advokats tidsposter i en period (date asc), med ärende-ref (perLawyer-rapporten). */
  listForLawyerInPeriod(organizationId: OrganizationId, userId: UserId, from: Date, to: Date): Promise<LawyerReportTimeEntry[]>;
  /** Alla debiterbara tidsposter i org:en (för fakturerat/AR-attribuering). */
  listBillableForOrg(organizationId: OrganizationId): Promise<TimeEntry[]>;
}
