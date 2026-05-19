/**
 * Tester för demo-repo-builder. Validerar att vi producerar giltiga
 * JSON-filer som AVA-projektionerna kan hydratisera.
 */

import { describe, it, expect } from "vitest";
import { buildDemoData } from "../../../scripts/build-demo-repo";
import { matterProjectionSchema } from "@/server/local-first/projections/matter";
import { contactProjectionSchema } from "@/server/local-first/projections/contact";
import { userProjectionSchema } from "@/server/local-first/projections/user";
import { matterContactSchema } from "@/server/local-first/projections/matter-contact";
import { documentSchema } from "@/server/local-first/projections/document";
import { timeEntrySchema } from "@/server/local-first/projections/time-entry";
import { expenseSchema } from "@/server/local-first/projections/expense";
import { invoiceSchema } from "@/server/local-first/projections/invoice";

describe("buildDemoData", () => {
  const all = buildDemoData();

  function byPrefix(prefix: string): unknown[] {
    return all.filter((e) => e.path.startsWith(prefix)).map((e) => e.data);
  }

  it("har minst 3 matters, 5 contacts, 2 users", () => {
    expect(byPrefix("matters/").length).toBeGreaterThanOrEqual(3);
    expect(byPrefix("contacts/").length).toBeGreaterThanOrEqual(5);
    expect(byPrefix(".ava/users/").length).toBeGreaterThanOrEqual(2);
  });

  it("har MatterContact-länkar för varje matter", () => {
    expect(byPrefix("matter-contacts/").length).toBeGreaterThan(0);
  });

  it("har documents + time-entries + expenses + invoices", () => {
    expect(byPrefix("documents/").length).toBeGreaterThan(0);
    expect(byPrefix("time-entries/").length).toBeGreaterThan(0);
    expect(byPrefix("expenses/").length).toBeGreaterThan(0);
    expect(byPrefix("invoices/").length).toBeGreaterThan(0);
  });

  const schemas: Array<[string, { parse: (d: unknown) => unknown }]> = [
    ["matters/", matterProjectionSchema],
    ["contacts/", contactProjectionSchema],
    [".ava/users/", userProjectionSchema],
    ["matter-contacts/", matterContactSchema],
    ["documents/", documentSchema],
    ["time-entries/", timeEntrySchema],
    ["expenses/", expenseSchema],
    ["invoices/", invoiceSchema],
  ];

  for (const [prefix, schema] of schemas) {
    it(`alla ${prefix} validerar mot sitt projection-schema`, () => {
      for (const d of byPrefix(prefix)) {
        expect(() => schema.parse(d)).not.toThrow();
      }
    });
  }
});
