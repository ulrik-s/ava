/**
 * Enhetstest för loadPeriodWork (#2113): periodens arbete för en jurist eller
 * hela byrån, mot riktig DemoDataStore och in-memory-repona.
 */
import { describe, it, expect } from "vitest-compat";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { loadPeriodWork } from "@/lib/server/reports/period-work";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = asId<"OrganizationId">("org-1");
const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-10-31T23:59:59Z");

const entry = (id: string, userId: string, matterId: string, day: string) => ({
  id, organizationId: matterId === "m-2" ? "org-2" : "org-1", userId, matterId,
  date: new Date(`${day}T09:00:00Z`), minutes: 60, hourlyRate: 250_000, billable: true, description: id,
});
const expense = (id: string, userId: string, matterId: string, day: string) => ({
  id, userId, matterId, date: new Date(`${day}T09:00:00Z`), amount: 10_000, billable: true, description: id,
});

function setup(users = [
  { id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "LAWYER" },
  { id: "u-2", organizationId: "org-1", email: "b@x", name: "Bo", role: "LAWYER" },
]) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrå" }, { id: "org-2", name: "Annan" }],
    matters: [
      { id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "A", status: "ACTIVE" },
      { id: "m-2", organizationId: "org-2", matterNumber: "2026-0002", title: "B", status: "ACTIVE" },
    ],
    users: [...users, { id: "u-9", organizationId: "org-2", email: "c@x", name: "Cia", role: "LAWYER" }],
    timeEntries: [
      entry("te-u2-late", "u-2", "m-1", "2026-10-20"),
      entry("te-u1-mid", "u-1", "m-1", "2026-10-10"),
      entry("te-u2-early", "u-2", "m-1", "2026-10-02"),
      entry("te-u1-out", "u-1", "m-1", "2026-11-05"),
      entry("te-foreign", "u-9", "m-2", "2026-10-05"),
    ],
    expenses: [
      expense("ex-u1", "u-1", "m-1", "2026-10-15"),
      expense("ex-u2", "u-2", "m-1", "2026-10-03"),
      expense("ex-foreign", "u-9", "m-2", "2026-10-04"),
    ],
  }, async () => {});
  return buildInMemoryRepositories(ds);
}

const ids = (rows: ReadonlyArray<{ id: unknown }>) => rows.map((r) => String(r.id));

describe("loadPeriodWork", () => {
  it("lawyer ger samma poster som listForLawyerInPeriod för juristen", async () => {
    const repos = setup();
    const userId = asId<"UserId">("u-1");
    const work = await loadPeriodWork(repos, ORG, { kind: "lawyer", userId }, FROM, TO);
    expect(ids(work.timeEntries)).toEqual(ids(await repos.timeEntries.listForLawyerInPeriod(ORG, userId, FROM, TO)));
    expect(ids(work.expenses)).toEqual(ids(await repos.expenses.listForLawyerInPeriod(ORG, userId, FROM, TO)));
    expect(ids(work.timeEntries)).toEqual(["te-u1-mid"]);
    expect(ids(work.expenses)).toEqual(["ex-u1"]);
  });

  it("firm ger alla användares poster i perioden, sorterade på datum, utan annan byrå", async () => {
    const repos = setup();
    const work = await loadPeriodWork(repos, ORG, { kind: "firm" }, FROM, TO);
    expect(ids(work.timeEntries)).toEqual(["te-u2-early", "te-u1-mid", "te-u2-late"]);
    expect(ids(work.expenses)).toEqual(["ex-u2", "ex-u1"]);
  });

  it("en byrå utan användare ger tomma listor", async () => {
    const repos = setup([]);
    const work = await loadPeriodWork(repos, ORG, { kind: "firm" }, FROM, TO);
    expect(work).toEqual({ timeEntries: [], expenses: [] });
  });
});
