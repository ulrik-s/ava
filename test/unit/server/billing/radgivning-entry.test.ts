/**
 * `markEntryAsRadgivning` (#1207) — försvarsvägen när postens ärende inte går
 * att läsa i organisationen (inkonsistent data). Happy path + avvisningar körs
 * genom routern i `timeEntry-mark-radgivning.test.ts`.
 */
import { describe, expect, it } from "vitest-compat";
import { markEntryAsRadgivning, type RadgivningRepos } from "@/lib/server/billing/radgivning-entry";
import type { TimeEntry } from "@/lib/shared/schemas/billing";
import { asId } from "@/lib/shared/schemas/ids";

const ENTRY: TimeEntry = {
  id: asId<"TimeEntryId">("t-1"), userId: asId<"UserId">("u-1"), matterId: asId<"MatterId">("m-1"),
  date: new Date("2026-03-02"), minutes: 45, description: "Möte", billable: true,
} as TimeEntry; // Testdubblett: bara fälten regeln läser.

const unused = (): never => { throw new Error("ska inte anropas"); };

function stubRepos(): RadgivningRepos {
  return {
    timeEntries: { getByIdInOrg: async () => ENTRY, listByInvoice: unused, update: unused, create: unused },
    matters: { getByIdInOrg: async () => null },
    invoices: { listByMatter: unused },
  };
}

describe("markEntryAsRadgivning", () => {
  it("postens ärende saknas i organisationen → NOT_FOUND", async () => {
    await expect(markEntryAsRadgivning(stubRepos(), asId<"OrganizationId">("org-1"), ENTRY.id, new Date()))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
