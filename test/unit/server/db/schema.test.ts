/**
 * Drizzle-schema (#408) — verifierar reconcile-konventionerna (ADR 0017/0019)
 * över ALLA entiteter: id/createdAt/updatedAt/version/deletedAt, org-scope där
 * zod har det, och change_log:s delta-sync-form.
 */

import { getTableColumns } from "drizzle-orm";
import { describe, it, expect } from "vitest-compat";
import * as schema from "@/lib/server/db/schema";

const baseCols = ["id", "createdAt", "updatedAt", "version", "deletedAt"];

// Alla muterbara entitets-tabeller (change_log undantaget — egen form).
const entityTables = Object.entries(schema).filter(
  ([name, t]) => name !== "changeLog" && t && typeof t === "object" && "id" in getTableColumnsSafe(t),
);

function getTableColumnsSafe(t: unknown): Record<string, unknown> {
  try {
    const cols = getTableColumns(t as Parameters<typeof getTableColumns>[0]);
    // relations()-exporter ger ingen kolumn-map → behandla som "ingen tabell".
    return cols && typeof cols === "object" ? cols : {};
  } catch {
    return {};
  }
}

const ORG_SCOPED = ["offices", "users", "contacts", "matters", "expectedReceivables",
  "calendarEvents", "tasks", "serviceNotes", "orgPreferences", "documentTemplates"];

describe("Drizzle-schema — bas-konventioner (alla entiteter)", () => {
  it(`täcker ${entityTables.length} entitets-tabeller`, () => {
    expect(entityTables.length).toBeGreaterThanOrEqual(28);
  });

  for (const [name, table] of entityTables) {
    it(`${name} har ${baseCols.join("/")}`, () => {
      const cols = Object.keys(getTableColumns(table as Parameters<typeof getTableColumns>[0]));
      for (const c of baseCols) expect(cols).toContain(c);
    });
  }
});

describe("Drizzle-schema — org-scope", () => {
  it("org-scopade tabeller har organizationId", () => {
    for (const name of ORG_SCOPED) {
      const t = (schema as Record<string, unknown>)[name];
      expect(Object.keys(getTableColumns(t as Parameters<typeof getTableColumns>[0]))).toContain("organizationId");
    }
  });

  it("organizations har INTE organizationId (är org:en själv)", () => {
    expect(Object.keys(getTableColumns(schema.organizations))).not.toContain("organizationId");
  });

  it("billing-entiteter scopar via parent (ingen egen organizationId)", () => {
    for (const t of [schema.timeEntries, schema.expenses, schema.invoices, schema.payments, schema.billingRuns]) {
      expect(Object.keys(getTableColumns(t))).not.toContain("organizationId");
    }
  });
});

describe("change_log — delta-sync-form", () => {
  it("har seq/organizationId/entity/rowId/version/op/at", () => {
    const cols = Object.keys(getTableColumns(schema.changeLog));
    for (const c of ["seq", "organizationId", "entity", "rowId", "version", "op", "at"]) {
      expect(cols).toContain(c);
    }
  });
});
