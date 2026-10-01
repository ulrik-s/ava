/**
 * Serverns auktoritativa läge (#1366): det invarianterna prövas mot.
 * Läser direkt ur byråns Postgres-databas — aldrig via API:t, så att ett fel
 * i API:t inte kan dölja sig självt.
 */

import postgres from "postgres";
import { z } from "zod";
import type { OrgTarget } from "./config";
import type { Projected } from "./invariants";

const idRows = z.array(z.object({ id: z.string() }));
const numberRows = z.array(z.object({ n: z.string() }));
const countRow = z.object({ n: z.coerce.number() });
const jobRows = z.array(z.object({ state: z.string(), n: z.coerce.number() }));
const analysisRows = z.array(z.object({ status: z.string(), n: z.coerce.number() }));
const projectedRows = z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])));

/** Entiteterna konvergensen jämför (klientens källnycklar). */
export const CONVERGENCE_VIEW_NAMES = ["timeEntries", "expenses", "contacts", "invoices", "matters", "serviceNotes"] as const;

export type ConvergenceView = (typeof CONVERGENCE_VIEW_NAMES)[number];

/** Tabellen och fälten (camelCase som klientens rader) per entitet. */
export const CONVERGENCE_VIEWS: Readonly<Record<ConvergenceView, { table: string; fields: readonly string[] }>> = {
  timeEntries: { table: "time_entries", fields: ["id", "minutes", "description", "version"] },
  expenses: { table: "expenses", fields: ["id", "amount", "description", "version"] },
  contacts: { table: "contacts", fields: ["id", "name", "version"] },
  invoices: { table: "invoices", fields: ["id", "invoiceNumber", "amount", "version"] },
  matters: { table: "matters", fields: ["id", "matterNumber", "status", "version"] },
  serviceNotes: { table: "service_notes", fields: ["id", "text", "version"] },
};

const snake = (f: string): string => f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Tal kommer som text ur int8/numeric — gör dem till tal som klientens rader. */
const column = (f: string): string => (["minutes", "amount", "version"].includes(f) ? `${snake(f)}::float8 AS "${f}"` : `${snake(f)}::text AS "${f}"`);

/** Läsåtkomst till en byrås databas. */
export class ServerDb {
  readonly sql;

  constructor(readonly org: OrgTarget) {
    this.sql = postgres(org.databaseUrl, { max: 2, onnotice: () => {} });
  }

  /** Vilka av `ids` som finns i `table` (en rad per träff — dubbletter syns). */
  async existing(table: "time_entries" | "expenses" | "contacts" | "service_notes" | "documents", ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.sql.unsafe(`SELECT id::text AS id FROM ${table} WHERE id = ANY($1::uuid[])`, [[...ids]]);
    return idRows.parse(rows).map((r) => r.id);
  }

  /** Byråns alla fakturanummer. */
  async invoiceNumbers(): Promise<string[]> {
    const rows = await this.sql`SELECT i.invoice_number AS n FROM invoices i JOIN matters m ON m.id = i.matter_id
      WHERE m.organization_id = ${this.org.organizationId} AND i.invoice_number IS NOT NULL`;
    return numberRows.parse(rows).map((r) => r.n);
  }

  /** Byråns alla kostnadsräkningsreferenser (KR-ÅÅÅÅ-NNNN). */
  async krReferences(): Promise<string[]> {
    const rows = await this.sql`SELECT b.reference AS n FROM billing_runs b JOIN matters m ON m.id = b.matter_id
      WHERE m.organization_id = ${this.org.organizationId} AND b.type = 'KOSTNADSRAKNING' AND b.reference IS NOT NULL`;
    return numberRows.parse(rows).map((r) => r.n);
  }

  /** Sparade utfall (sync_replays) för ett köat anrop. */
  async storedOutcomes(mutationId: string): Promise<number> {
    const rows = await this.sql`SELECT count(*) AS n FROM sync_replays WHERE mutation_id = ${mutationId}`;
    return countRow.parse(rows[0]).n;
  }

  /** Jobben i en pg-boss-kö per tillstånd (created/retry/active/completed/failed). */
  async jobStates(queue: string): Promise<Record<string, number>> {
    const rows = await this.sql`SELECT state::text AS state, count(*) AS n FROM pgboss.job WHERE name = ${queue} GROUP BY state`.catch(() => []);
    return Object.fromEntries(jobRows.parse(rows).map((r) => [r.state, r.n]));
  }

  /** Dokumentens analysstatus för `ids`. */
  async analysisStatuses(ids: readonly string[]): Promise<Record<string, number>> {
    if (ids.length === 0) return {};
    const rows = await this.sql`SELECT analysis_status AS status, count(*) AS n FROM documents WHERE id = ANY(${[...ids]}::uuid[]) GROUP BY analysis_status`;
    return Object.fromEntries(analysisRows.parse(rows).map((r) => [r.status, r.n]));
  }

  /** Serverns rader för en konvergensvy (inte borttagna), projicerade som klientens. */
  async view(view: ConvergenceView): Promise<Projected[]> {
    const { table, fields } = CONVERGENCE_VIEWS[view];
    const rows = await this.sql.unsafe(`SELECT ${fields.map(column).join(", ")} FROM ${table} WHERE deleted_at IS NULL ORDER BY id`);
    return projectedRows.parse(rows);
  }

  close(): Promise<void> {
    return this.sql.end({ timeout: 5 });
  }
}
