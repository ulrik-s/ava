/**
 * Regressionsskydd: `_count: { select: { rel: true } }` måste räkna även
 * när relationen INTE separat include:ats.
 *
 * Bug: dashboardens "0 dok / 0 tidposter" — applyCount läste bara redan-
 * hydrerade relationer; documents/timeEntries hydrerades inte (bara i
 * _count.select) → undefined → 0.
 */

import { describe, it, expect } from "vitest";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";

const ORG = "firma-ab";

function store(): DemoDataStore {
  return new DemoDataStore({
    matters: [
      { id: "m-1", organizationId: ORG, matterNumber: "2026-0001", title: "X", status: "ACTIVE" },
    ],
    documents: [
      { id: "d-1", organizationId: ORG, matterId: "m-1", fileName: "a.pdf" },
      { id: "d-2", organizationId: ORG, matterId: "m-1", fileName: "b.pdf" },
      { id: "d-3", organizationId: ORG, matterId: "m-other", fileName: "c.pdf" },
    ],
    timeEntries: [
      { id: "te-1", organizationId: ORG, matterId: "m-1", minutes: 30, userId: "u-1" },
    ],
    matterContacts: [
      { id: "mc-1", organizationId: ORG, matterId: "m-1", contactId: "c-1", role: "KLIENT" },
    ],
  });
}

describe("_count utan explicit include", () => {
  it("räknar documents + timeEntries + contacts korrekt", async () => {
    const ds = store();
    const rows = await ds.matters.findMany({
      where: { organizationId: ORG },
      include: { _count: { select: { documents: true, timeEntries: true, contacts: true } } },
    }) as Array<{ _count: { documents: number; timeEntries: number; contacts: number } }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!._count.documents).toBe(2);   // d-1, d-2 (inte d-3 → annan matter)
    expect(rows[0]!._count.timeEntries).toBe(1);
    expect(rows[0]!._count.contacts).toBe(1);
  });

  it("räknar 0 korrekt när inga relationer finns", async () => {
    const ds = new DemoDataStore({
      matters: [{ id: "m-empty", organizationId: ORG, matterNumber: "2026-0099", title: "Tom", status: "ACTIVE" }],
    });
    const rows = await ds.matters.findMany({
      where: { organizationId: ORG },
      include: { _count: { select: { documents: true, timeEntries: true } } },
    }) as Array<{ _count: { documents: number; timeEntries: number } }>;
    expect(rows[0]!._count.documents).toBe(0);
    expect(rows[0]!._count.timeEntries).toBe(0);
  });

  it("count + samtidig include av annan relation fungerar ihop", async () => {
    const ds = store();
    const rows = await ds.matters.findMany({
      where: { organizationId: ORG },
      include: {
        contacts: true,
        _count: { select: { documents: true } },
      },
    }) as Array<{ contacts: unknown[]; _count: { documents: number } }>;
    expect(Array.isArray(rows[0]!.contacts)).toBe(true);
    expect(rows[0]!._count.documents).toBe(2);
  });
});
