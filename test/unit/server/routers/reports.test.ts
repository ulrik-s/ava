/**
 * Test för reportsRouter — perLawyer-rapporten med tre delrapporter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { reportsRouter } from "@/lib/server/routers/reports";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  user: { findFirst: vi.fn() },
  timeEntry: { findMany: vi.fn() },
  expense: { findMany: vi.fn() },
};

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "u-self", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma,
    dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
    get repos() { return buildInMemoryRepositories(this.dataStore as unknown as IDataStore); },
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
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "Anna", hourlyRate: 3000 });
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
    expect(res!.matters[0]!.workValueOre).toBe(60 / 60 * 3000); // 60 min × 3000 öre/h (hourlyRate ÄR öre)
    expect(res!.matters[0]!.expenseOre).toBe(50000);
  });

  it("totals summerar alla ärenden", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRate: 1000 });
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
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRate: 1000 });
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    const res = await makeCaller().perLawyer({
      from: "2026-04-01", to: "2026-04-30", userId: "u1",
    });
    expect(res!.weeklyRows.length).toBeGreaterThan(0);
    expect(res!.weeklyRows[0]).toHaveProperty("isoYear");
    expect(res!.weeklyRows[0]).toHaveProperty("week");
  });

  it("listar bara ofakturerat (utan invoiceId) i unbilled", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRate: 1000 });
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
    expect(res!.unbilled.rows[0]!.timeOre).toBe(30 / 60 * 1000); // hourlyRate ÄR öre
  });

  it("ignorerar non-billable i workValueOre och unbilled", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRate: 1000 });
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
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "A", hourlyRate: 1000 });
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
