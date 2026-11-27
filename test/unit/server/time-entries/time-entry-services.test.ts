/**
 * Tidspostens tjänster utbrutna ur timeEntry-routern (#2176): låsregeln,
 * minutregeln, á-priset, flytten och rapportgrupperingen. Mot riktig
 * DemoDataStore och in-memory-repona, utan tRPC-kontext.
 */
import { TRPCError } from "@trpc/server";
import { describe, it, expect } from "vitest-compat";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import {
  assertEditable, assertMinutes, rateFor, rateOnCreate, rateOnKindChange,
} from "@/lib/server/time-entries/entry-rules";
import { moveEntries } from "@/lib/server/time-entries/move-entries";
import { groupByUser, loadTimeReport } from "@/lib/server/time-entries/time-report";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = asId<"OrganizationId">("org-1");
const M1 = asId<"MatterId">("m-1");
const M2 = asId<"MatterId">("m-2");

const entry = (id: string, matterId: string, extra: Record<string, unknown> = {}) => ({
  id, organizationId: "org-1", userId: "u-1", matterId, date: new Date("2026-10-10T09:00:00Z"),
  minutes: 60, hourlyRate: 100_000, billable: true, description: id, kind: "ARBETE", ...extra,
});

function setup() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrå", hourlyRates: { ARBETE: 150_000, TIDSSPILLAN: 90_000 } }],
    matters: [
      { id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "A", status: "ACTIVE" },
      { id: "m-2", organizationId: "org-1", matterNumber: "2026-0002", title: "B", status: "ACTIVE", hourlyRates: { ARBETE: 200_000 } },
    ],
    users: [
      { id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "LAWYER" },
      { id: "u-2", organizationId: "org-1", email: "b@x", name: "Bo", role: "LAWYER" },
    ],
    timeEntries: [
      entry("te-1", "m-1"),
      entry("te-2", "m-1", { userId: "u-2", billable: false, minutes: 30 }),
      entry("te-in-m2", "m-2"),
      entry("te-locked", "m-1", { invoiceId: "inv-1" }),
    ],
  }, async () => {});
  return buildInMemoryRepositories(ds);
}

async function owned(repos: ReturnType<typeof setup>, id: string) {
  const row = await repos.timeEntries.getByIdInOrg(asId<"TimeEntryId">(id), ORG);
  if (!row) throw new Error(`saknar ${id}`);
  return row;
}

describe("entry-rules", () => {
  it("assertEditable vägrar en låst post med PRECONDITION_FAILED och släpper en olåst", () => {
    expect(() => assertEditable({ invoiceId: asId<"InvoiceId">("inv-1") })).toThrow(TRPCError);
    expect(() => assertEditable({ frozenAt: new Date() })).toThrow(/kan inte ändras/);
    expect(() => assertEditable({})).not.toThrow();
  });

  it("assertMinutes: noll minuter bara för per-dygns-kategorier", () => {
    expect(() => assertMinutes({ minutes: 0, kind: "ARBETE" })).toThrow(/minst en minut/);
    expect(() => assertMinutes({ minutes: 0, kind: "ADVOKATBEREDSKAP" })).not.toThrow();
    expect(() => assertMinutes({ minutes: 15 })).not.toThrow();
  });

  it("rateOnCreate: ett explicit á-pris vinner, utom för beredskap; annars räknas priset", async () => {
    const repos = setup();
    const subject = { kind: "ARBETE" as const, matterId: M1, date: "2026-10-10", userRates: {} };
    expect(await rateOnCreate(repos, ORG, subject, 123)).toBe(123);
    expect(await rateOnCreate(repos, ORG, subject, undefined)).toBe(150_000);
    const beredskap = await rateOnCreate(repos, ORG, { ...subject, kind: "ADVOKATBEREDSKAP" }, 123);
    expect(beredskap).not.toBe(123);
  });

  it("rateFor räknar med postens jurist och det nya ärendet", async () => {
    const repos = setup();
    expect(await rateFor(repos, ORG, await owned(repos, "te-1"), { kind: "ARBETE", matterId: M2 })).toBe(200_000);
  });

  it("rateOnKindChange: oförändrad eller utelämnad kategori rör inte priset", async () => {
    const repos = setup();
    const te = await owned(repos, "te-1");
    expect(await rateOnKindChange(repos, ORG, te, undefined)).toBeUndefined();
    expect(await rateOnKindChange(repos, ORG, te, "ARBETE")).toBeUndefined();
    expect(await rateOnKindChange(repos, ORG, te, "TIDSSPILLAN")).toBe(90_000);
  });
});

describe("moveEntries", () => {
  it("flyttar med målärendets pris och lämnar en post som redan ligger där orörd", async () => {
    const repos = setup();
    const moved = await moveEntries(repos, ORG, [asId("te-1"), asId("te-in-m2")], M2);
    expect(moved.map((e) => String(e.id))).toEqual(["te-1"]);
    expect(String(moved[0]?.matterId)).toBe("m-1");
    const after = await owned(repos, "te-1");
    expect(String(after.matterId)).toBe("m-2");
    expect(after.hourlyRate).toBe(200_000);
  });

  it("en okänd eller låst post vägrar hela anropet innan något skrivs", async () => {
    const repos = setup();
    await expect(moveEntries(repos, ORG, [asId("te-1"), asId("finns-ej")], M2)).rejects.toThrow(TRPCError);
    await expect(moveEntries(repos, ORG, [asId("te-1"), asId("te-locked")], M2)).rejects.toThrow(/kan inte ändras/);
    expect(String((await owned(repos, "te-1")).matterId)).toBe("m-1");
  });
});

describe("tidsrapporten per jurist", () => {
  it("grupperar per jurist med totala och debiterbara minuter", async () => {
    const repos = setup();
    const report = await loadTimeReport(repos, ORG, {
      from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-31T23:59:59Z"), matterId: M1,
    });
    expect(report.totalEntries).toBe(3);
    expect(report.byUser["u-1"]).toMatchObject({ name: "Anna", totalMinutes: 120, billableMinutes: 120 });
    expect(report.byUser["u-2"]).toMatchObject({ name: "Bo", totalMinutes: 30, billableMinutes: 0 });
    expect(report.byUser["u-2"]?.entries.map((e) => String(e.id))).toEqual(["te-2"]);
  });

  it("inga rader ger en tom rapport", () => {
    expect(groupByUser([])).toEqual({ byUser: {}, totalEntries: 0 });
  });
});
