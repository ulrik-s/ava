/**
 * Test för expenseRouter — list/create/update/delete.
 *
 * update/delete org-scopas via matter (#60): `findFirst` med
 * `matter: { organizationId }` innan mutation, NOT_FOUND vid mismatch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { expenseRouter } from "@/lib/server/routers/expense";
import { dataStoreFromMockPrisma, reposFromMockDataStore } from "../helpers/mock-data-store";

const mockPrisma = {
  matter: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
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

function makeCaller(orgId = "org-a", userId = "u1", extra: { role?: string; queued?: { mutationId: string; at: number } } = {}) {
  const dataStore = dataStoreFromMockPrisma(mockPrisma);
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: extra.role ?? "LAWYER", organizationId: orgId },
    ...(extra.queued ? { queued: extra.queued } : {}),
    prisma: mockPrisma, dataStore,
    repos: reposFromMockDataStore(dataStore),
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
  // Default: ärendet tillhör anropande org (create kontrollerar det, #1276).
  mockPrisma.matter.findFirst.mockResolvedValue({ id: "m1", organizationId: "org-a" });
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

  it("ärende i en annan byrå → NOT_FOUND, inget skapas (#1276)", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().create({ matterId: "m-annan", date: "2026-04-15", amount: 100, description: "X" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.expense.create).not.toHaveBeenCalled();
  });

  it("validerar belopp > 0", async () => {
    await expect(
      makeCaller().create({ matterId: "m1", date: "2026-01-01", amount: 0, description: "X" }),
    ).rejects.toThrow();
  });
});

describe("expense.create — setup-fält (#1345)", () => {
  const base = { matterId: "m1", date: "2026-04-15", amount: 10000, description: "Taxi" } as const;
  const queued = { mutationId: "019a0000-0000-7000-8000-000000000003", at: Date.parse("2026-04-15") };

  beforeEach(() => { mockPrisma.expense.create.mockResolvedValue({ id: "e1" }); });

  it.each([
    ["userId (kollega)", { userId: "u-kollega" }],
    ["invoiceId", { invoiceId: "inv-1" }],
    ["createdAt", { createdAt: "2020-01-01T00:00:00.000Z" }],
  ])("en jurist kan inte sätta %s — FORBIDDEN, inget skapas", async (_label, extra) => {
    await expect(makeCaller().create({ ...base, ...extra })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockPrisma.expense.create).not.toHaveBeenCalled();
  });

  it("ett köat anrop får inte bära setup-fält, inte ens från ADMIN", async () => {
    await expect(makeCaller("org-a", "u1", { role: "ADMIN", queued }).create({ ...base, userId: "u-kollega" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockPrisma.expense.create).not.toHaveBeenCalled();
  });

  it("eget userId är inget setup-fält", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1" });
    await makeCaller("org-a", "u1", { queued }).create({ ...base, userId: "u1" });
    expect(mockPrisma.expense.create.mock.calls[0]![0].data.userId).toBe("u1");
  });

  it("ADMIN registrerar ett utlägg åt en kollega i byrån", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u-kollega" });
    await makeCaller("org-a", "u1", { role: "ADMIN" }).create({ ...base, userId: "u-kollega" });
    expect(mockPrisma.user.findFirst.mock.calls[0]![0].where).toMatchObject({ id: "u-kollega", organizationId: "org-a" });
    expect(mockPrisma.expense.create.mock.calls[0]![0].data.userId).toBe("u-kollega");
  });

  it("en kollega i en annan byrå → NOT_FOUND, inget skapas", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(makeCaller("org-a", "u1", { role: "ADMIN" }).create({ ...base, userId: "u-annan" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.expense.create).not.toHaveBeenCalled();
  });
});

describe("låsta utlägg (#1276)", () => {
  it.each([
    ["fakturerat", { id: "e1", invoiceId: "inv-1" }],
    ["fryst av en körning", { id: "e1", frozenAt: new Date("2026-06-30"), frozenByBillingRunId: "run-1" }],
  ])("%s: update och delete → PRECONDITION_FAILED, inget skrivs", async (_label, locked) => {
    mockPrisma.expense.findFirst.mockResolvedValue(locked);
    await expect(makeCaller().update({ id: "e1", amount: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(makeCaller().delete({ id: "e1" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockPrisma.expense.update).not.toHaveBeenCalled();
    expect(mockPrisma.expense.delete).not.toHaveBeenCalled();
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
