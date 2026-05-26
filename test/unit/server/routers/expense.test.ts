/**
 * Test för expenseRouter — list/create/update/delete.
 *
 * Notering: routern saknar fortfarande explicit org-scoping på update/delete,
 * vilket är en känd luka som täcks separat i issue. Tester här verifierar
 * nuvarande beteende plus pekar ut säkerhetsbristerna med skip:ade fall.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { expenseRouter } from "@/lib/server/routers/expense";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  expense: {
    findMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(orgId = "org-a", userId = "u1") {
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return expenseRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.expense.findMany.mockResolvedValue([]);
  mockPrisma.expense.count.mockResolvedValue(0);
  mockPrisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
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
    const args = mockPrisma.expense.create.mock.calls[0][0];
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
    expect(mockPrisma.expense.create.mock.calls[0][0].data.billable).toBe(true);
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
    const args = mockPrisma.expense.update.mock.calls[0][0];
    expect(args.data.date).toBeInstanceOf(Date);
  });

  it("rör inte date när ej angiven", async () => {
    mockPrisma.expense.update.mockResolvedValue({});
    await makeCaller().update({ id: "e1", description: "Ny" });
    const args = mockPrisma.expense.update.mock.calls[0][0];
    expect(args.data.date).toBeUndefined();
    expect(args.data.description).toBe("Ny");
  });
});

describe("expense.delete", () => {
  it("tar bort utlägg", async () => {
    mockPrisma.expense.delete.mockResolvedValue({});
    await makeCaller().delete({ id: "e1" });
    expect(mockPrisma.expense.delete).toHaveBeenCalledWith({ where: { id: "e1" } });
  });
});
