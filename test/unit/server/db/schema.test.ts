/**
 * Drizzle-schema (#408) — verifierar reconcile-konventionerna (ADR 0017/0019):
 * varje muterbar tabell har id/createdAt/updatedAt/version/deletedAt, org-scopade
 * har organizationId, och change_log har sin delta-sync-form.
 */

import { getTableColumns } from "drizzle-orm";
import { describe, it, expect } from "vitest-compat";
import {
  organizations, offices, users, contacts, matters, matterContacts, changeLog,
} from "@/lib/server/db/schema";

const baseCols = ["id", "createdAt", "updatedAt", "version", "deletedAt"];
const tables = { organizations, offices, users, contacts, matters, matterContacts };

describe("Drizzle-schema — bas-konventioner", () => {
  for (const [name, table] of Object.entries(tables)) {
    it(`${name} har bas-kolumnerna ${baseCols.join("/")}`, () => {
      const cols = Object.keys(getTableColumns(table));
      for (const c of baseCols) expect(cols).toContain(c);
    });
  }

  it("org-scopade tabeller har organizationId; organizations + matterContacts har det inte", () => {
    for (const t of [offices, users, contacts, matters]) {
      expect(Object.keys(getTableColumns(t))).toContain("organizationId");
    }
    // organizations ÄR org:en (ingen själv-referens); matterContacts scopar via matter.
    expect(Object.keys(getTableColumns(organizations))).not.toContain("organizationId");
    const mc = Object.keys(getTableColumns(matterContacts));
    expect(mc).toContain("matterId");
    expect(mc).not.toContain("organizationId");
  });
});

describe("change_log — delta-sync-form", () => {
  it("har seq/organizationId/entity/rowId/version/op/at", () => {
    const cols = Object.keys(getTableColumns(changeLog));
    for (const c of ["seq", "organizationId", "entity", "rowId", "version", "op", "at"]) {
      expect(cols).toContain(c);
    }
  });
});
