/**
 * Test för expenseRouter — list/create/update/delete.
 *
 * update/delete org-scopas via matter (#60): `findFirst` med
 * `matter: { organizationId }` innan mutation, NOT_FOUND vid mismatch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { expenseRouter } from "@/lib/server/routers/expense";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  expense: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(orgId = "org-a", userId = "u1") {
  const dataStore = dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>);
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore,
    repos: buildInMemoryRepositories(dataStore as unknown as IDataStore),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return expenseRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.expense.findMany.mockResolvedValue([]);
  mockPrisma.expense.count.mockResolvedValue(0);
  mockPrisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  // Default: utlägget tillhör anropande org (happy path för update/delete).
  mockPrisma.expense.findFirst.mockResolvedValue({ id: "e1" });
});

describe("expense.list", () => {
  it("scopar via matter.organizationId", async () => {
    await makeCaller("org-a").list({});
    expect(mockPrisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matter: { organizationId: "org-a" } },
      }),
    );
  });

  it("filtrerar på matterId när angivet", async () => {
    await makeCaller().list({ matterId: "m1" });
    expect(mockPrisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ matterId: "m1" }),
      }),
    );
  });

  it("returnerar totalAmount från aggregate", async () => {
    mockPrisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 12345 } });
    const res = await makeCaller().list({});
    expect(res.totalAmount).toBe(12345);
  });

  it("returnerar 0 totalAmount när aggregate ger null", async () => {
    mockPrisma.expense.aggregate.mockResolvedValue({ _sum: { amount: null } });
    const res = await makeCaller().list({});
    expect(res.totalAmount).toBe(0);
  });
});

describe("expense.create", () => {
  it("kopplar userId från context och konverterar date-sträng", async () => {
    mockPrisma.expense.create.mockResolvedValue({ id: "e1" });
    await makeCaller("org-a", "u-9").create({
      matterId: "m1",
      date: "2026-04-15",
      amount: 50000,
      description: "Resa",
    });
    const args = mockPrisma.expense.create.mock.calls[0]![0];
    expect(args.data.userId).toBe("u-9");
    expect(args.data.date).toBeInstanceOf(Date);
    expect(args.data.amount).toBe(50000);
  });

  it("billable default = true", async () => {
    mockPrisma.expense.create.mockResolvedValue({});
    await makeCaller().create({
      matterId: "m1",
      date: "2026-04-15",
      amount: 100,
      description: "X",
    });
    expect(mockPrisma.expense.create.mock.calls[0]![0].data.billable).toBe(true);
  });

  it("validerar belopp > 0", async () => {
    await expect(
      makeCaller().create({ matterId: "m1", date: "2026-01-01", amount: 0, description: "X" }),
    ).rejects.toThrow();
  });
});

describe("expense.update", () => {
  it("konverterar date-sträng om angiven", async () => {
    mockPrisma.expense.update.mockResolvedValue({});
    await makeCaller().update({ id: "e1", date: "2026-05-01" });
    const args = mockPrisma.expense.update.mock.calls[0]![0];
    expect(args.data.date).toBeInstanceOf(Date);
  });

  it("rör inte date när ej angiven", async () => {
    mockPrisma.expense.update.mockResolvedValue({});
    await makeCaller().update({ id: "e1", description: "Ny" });
    const args = mockPrisma.expense.update.mock.calls[0]![0];
    expect(args.data.date).toBeUndefined();
    expect(args.data.description).toBe("Ny");
  });

  it("scopar ägarkollen via matter.organizationId (#60)", async () => {
    mockPrisma.expense.update.mockResolvedValue({});
    await makeCaller("org-a").update({ id: "e1", description: "X" });
    expect(mockPrisma.expense.findFirst).toHaveBeenCalledWith({
      where: { id: "e1", matter: { organizationId: "org-a" } },
    });
  });

  it("NOT_FOUND när utlägget inte tillhör org (#60) — och update körs ej", async () => {
    mockPrisma.expense.findFirst.mockResolvedValue(null);
    await expect(makeCaller("org-b").update({ id: "e1", description: "X" }))
      .rejects.toThrow(/NOT_FOUND/);
    expect(mockPrisma.expense.update).not.toHaveBeenCalled();
  });
});

describe("expense.delete", () => {
  it("tar bort utlägg", async () => {
    mockPrisma.expense.delete.mockResolvedValue({});
    await makeCaller().delete({ id: "e1" });
    expect(mockPrisma.expense.delete).toHaveBeenCalledWith({ where: { id: "e1" } });
  });

  it("NOT_FOUND när utlägget inte tillhör org (#60) — och delete körs ej", async () => {
    mockPrisma.expense.findFirst.mockResolvedValue(null);
    await expect(makeCaller("org-b").delete({ id: "e1" }))
      .rejects.toThrow(/NOT_FOUND/);
    expect(mockPrisma.expense.delete).not.toHaveBeenCalled();
  });
});
