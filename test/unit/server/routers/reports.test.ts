/**
 * Test för reportsRouter — perLawyer-rapporten med tre delrapporter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { reportsRouter } from "@/lib/server/routers/reports";
import { timeEntryValueOre } from "@/lib/shared/whole-kronor";
import { dataStoreFromMockPrisma, reposFromMockDataStore } from "../helpers/mock-data-store";

const mockPrisma = {
  user: { findFirst: vi.fn() },
  timeEntry: { findMany: vi.fn() },
  expense: { findMany: vi.fn() },
};

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "u-self", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma,
    dataStore: dataStoreFromMockPrisma(mockPrisma),
    get repos() { return reposFromMockDataStore(this.dataStore); },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return reportsRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
  mockPrisma.expense.findMany.mockResolvedValue([]);
});

const matter = (overrides: Record<string, unknown> = {}) => ({
  id: "m1",
  matterNumber: "2026-0001",
  title: "X",
  paymentMethod: "PENDING",
  paymentMethodNote: null,
  paymentMethodDecidedAt: null,
  contacts: [],
  ...overrides,
});

describe("reports.perLawyer", () => {
  it("returnerar null när användaren inte finns / fel org", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    const res = await makeCaller().perLawyer({
      from: "2026-01-01", to: "2026-12-31", userId: "u1",
    });
    expect(res).toBeNull();
  });

  it("aggregerar tid + utlägg per ärende", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "Anna", hourlyRates: { ARBETE: 3000 } });
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      {
        id: "t1", date: new Date("2026-04-15"), minutes: 60, billable: true,
        hourlyRate: 3000, description: "x", invoiceId: null, matter: matter(),
      },
      {
        id: "t2", date: new Date("2026-04-16"), minutes: 30, billable: false,
        hourlyRate: 3000, description: "y", invoiceId: null, matter: matter(),
      },
    ]);
    mockPrisma.expense.findMany.mockResolvedValue([
      { id: "e1", date: new Date("2026-04-15"), amount: 50000, billable: true, invoiceId: null, matter: matter() },
    ]);

    const res = await makeCaller().perLawyer({
      from: "2026-01-01", to: "2026-12-31", userId: "u1",
    });
    expect(res).not.toBeNull();
    expect(res!.matters).toHaveLength(1);
    expect(res!.matters[0]!.totalMinutes).toBe(90);
    expect(res!.matters[0]!.billableMinutes).toBe(60);
    expect(res!.matters[0]!.workValueOre).toBe(timeEntryValueOre(60, 3000)); // 60 min × 3000 öre/h (hourlyRate ÄR öre)
    expect(res!.matters[0]!.expenseOre).toBe(50000);
  });

  it("totals summerar alla ärenden", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRates: { ARBETE: 1000 } });
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      { id: "1", date: new Date("2026-04-01"), minutes: 60, billable: true, hourlyRate: 1000, description: "", invoiceId: null,
        matter: matter({ id: "m1", matterNumber: "0001" }) },
      { id: "2", date: new Date("2026-04-02"), minutes: 90, billable: true, hourlyRate: 1000, description: "", invoiceId: null,
        matter: matter({ id: "m2", matterNumber: "0002" }) },
    ]);
    const res = await makeCaller().perLawyer({
      from: "2026-01-01", to: "2026-12-31", userId: "u1",
    });
    expect(res!.totals.totalMinutes).toBe(150);
    expect(res!.totals.billableMinutes).toBe(150);
  });

  it("genererar weeklyRows med ISO-veckor i intervallet", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRates: { ARBETE: 1000 } });
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    const res = await makeCaller().perLawyer({
      from: "2026-04-01", to: "2026-04-30", userId: "u1",
    });
    expect(res!.weeklyRows.length).toBeGreaterThan(0);
    expect(res!.weeklyRows[0]).toHaveProperty("isoYear");
    expect(res!.weeklyRows[0]).toHaveProperty("week");
  });

  it("listar bara ofakturerat (utan invoiceId) i unbilled", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRates: { ARBETE: 1000 } });
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      { id: "billed", date: new Date("2026-04-01"), minutes: 60, billable: true, hourlyRate: 1000, description: "", invoiceId: "inv1",
        matter: matter() },
      { id: "unbilled", date: new Date("2026-04-02"), minutes: 30, billable: true, hourlyRate: 1000, description: "", invoiceId: null,
        matter: matter() },
    ]);
    const res = await makeCaller().perLawyer({
      from: "2026-01-01", to: "2026-12-31", userId: "u1",
    });
    expect(res!.unbilled.rows).toHaveLength(1);
    expect(res!.unbilled.rows[0]!.timeOre).toBe(timeEntryValueOre(30, 1000)); // hourlyRate ÄR öre
  });

  it("ignorerar non-billable i workValueOre och unbilled", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRates: { ARBETE: 1000 } });
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      { id: "1", date: new Date("2026-04-01"), minutes: 60, billable: false, hourlyRate: 1000, description: "", invoiceId: null,
        matter: matter() },
    ]);
    const res = await makeCaller().perLawyer({
      from: "2026-01-01", to: "2026-12-31", userId: "u1",
    });
    expect(res!.matters[0]!.totalMinutes).toBe(60);
    expect(res!.matters[0]!.billableMinutes).toBe(0);
    expect(res!.matters[0]!.workValueOre).toBe(0);
    expect(res!.unbilled.rows).toHaveLength(0);
  });

  it("propagerar paymentMethod och note till MatterAgg", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRates: { ARBETE: 1000 } });
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      { id: "1", date: new Date("2026-04-01"), minutes: 30, billable: true, hourlyRate: 1000, description: "", invoiceId: null,
        matter: matter({ paymentMethod: "RATTSHJALP", paymentMethodNote: "Diarienr X" }) },
    ]);
    const res = await makeCaller().perLawyer({
      from: "2026-01-01", to: "2026-12-31", userId: "u1",
    });
    expect(res!.matters[0]!.paymentMethod).toBe("RATTSHJALP");
    expect(res!.matters[0]!.paymentMethodNote).toBe("Diarienr X");
  });
});

describe("reports.perLawyer — den svenska dagen (#1798)", () => {
  const entry = (id: string, date: Date) => ({
    id, date, minutes: 60, billable: true, hourlyRate: 1000, description: "", invoiceId: null, matter: matter(),
  });
  const JUNE = { from: "2026-06-01", to: "2026-06-30", userId: "u1" };

  beforeEach(() => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRates: { ARBETE: 1000 } });
  });

  it("perioden går från svensk midnatt den första till svensk midnatt efter den sista", async () => {
    await makeCaller().perLawyer(JUNE);
    const where = mockPrisma.timeEntry.findMany.mock.calls[0]?.[0]?.where;
    expect(where?.date.gte.toISOString()).toBe("2026-05-31T22:00:00.000Z");
    expect(where?.date.lte.toISOString()).toBe("2026-06-30T21:59:59.999Z");
  });

  it("en tidspost kl. 00:30 svensk tid en måndag hamnar i måndagens vecka", async () => {
    // 2026-06-07T22:30Z = måndag 8 juni 00:30 i Stockholm → vecka 24, inte 23.
    mockPrisma.timeEntry.findMany.mockResolvedValue([entry("t1", new Date("2026-06-07T22:30:00Z"))]);
    const res = await makeCaller().perLawyer(JUNE);
    const w23 = res?.weeklyRows.find((w) => w.week === 23);
    const w24 = res?.weeklyRows.find((w) => w.week === 24);
    expect(w23?.totalMinutes).toBe(0);
    expect(w24?.totalMinutes).toBe(60);
    expect(w24).toMatchObject({ isoYear: 2026, start: "2026-06-08", end: "2026-06-14" });
  });

  it("en tidspost sparad som rent datum hamnar i samma vecka som i dag", async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([entry("t1", new Date("2026-06-01"))]);
    const res = await makeCaller().perLawyer(JUNE);
    expect(res?.weeklyRows[0]).toMatchObject({ isoYear: 2026, week: 23, start: "2026-06-01", totalMinutes: 60 });
    expect(res?.weeklyRows.at(-1)).toMatchObject({ week: 27, end: "2026-07-05" });
  });
});
