/**
 * preferenceRouter — sparar/läser per-user och per-org-globala vy-prefs.
 * Säkerhetstest: setOrgDefault + clearOrgDefault kräver ADMIN.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { preferenceRouter } from "@/lib/server/routers/preference";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  userPreference: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
  orgPreference: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: vi.fn(<T,>(fn: (tx: any) => Promise<T>) => fn(mockPrisma)),
};

function makeCaller(role: "ADMIN" | "LAWYER" = "LAWYER", orgId = "org-a", userId = "u1") {
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role, organizationId: orgId },
    prisma: mockPrisma,
    dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return preferenceRouter.createCaller(ctx as any);
}

beforeEach(() => vi.clearAllMocks());

describe("prefs.get", () => {
  it("returnerar både user- och org-prefs för key:n", async () => {
    mockPrisma.userPreference.findFirst.mockResolvedValue({ prefs: { sort: "name" } });
    mockPrisma.orgPreference.findFirst.mockResolvedValue({ prefs: { sort: "createdAt" } });
    const res = await makeCaller().get({ key: "list.contacts" });
    expect(res).toEqual({ user: { sort: "name" }, org: { sort: "createdAt" } });
  });

  it("null när inget finns", async () => {
    mockPrisma.userPreference.findFirst.mockResolvedValue(null);
    mockPrisma.orgPreference.findFirst.mockResolvedValue(null);
    expect(await makeCaller().get({ key: "list.x" })).toEqual({ user: null, org: null });
  });
});

describe("prefs.save (upsert)", () => {
  it("skapar ny när ingen finns", async () => {
    mockPrisma.userPreference.findFirst.mockResolvedValue(null);
    mockPrisma.userPreference.create.mockResolvedValue({ id: "p1" });
    await makeCaller().save({ key: "list.contacts", prefs: { sort: "name" } });
    expect(mockPrisma.userPreference.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "u1", organizationId: "org-a", key: "list.contacts", prefs: { sort: "name" } }),
    }));
  });

  it("uppdaterar befintlig", async () => {
    mockPrisma.userPreference.findFirst.mockResolvedValue({ id: "p1" });
    mockPrisma.userPreference.update.mockResolvedValue({ id: "p1" });
    await makeCaller().save({ key: "list.contacts", prefs: { sort: "email" } });
    expect(mockPrisma.userPreference.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "p1" }, data: { prefs: { sort: "email" } },
    }));
  });
});

describe("prefs.setOrgDefault — ADMIN-skydd", () => {
  it("ADMIN får sätta org-default", async () => {
    mockPrisma.orgPreference.findFirst.mockResolvedValue(null);
    mockPrisma.orgPreference.create.mockResolvedValue({ id: "o1" });
    await makeCaller("ADMIN").setOrgDefault({ key: "list.contacts", prefs: { sort: "name" } });
    expect(mockPrisma.orgPreference.create).toHaveBeenCalled();
  });

  it("Icke-ADMIN blockeras (FORBIDDEN)", async () => {
    await expect(makeCaller("LAWYER").setOrgDefault({ key: "list.contacts", prefs: { sort: "name" } }))
      .rejects.toThrow(TRPCError);
    expect(mockPrisma.orgPreference.create).not.toHaveBeenCalled();
  });

  it("clearOrgDefault kräver ADMIN", async () => {
    await expect(makeCaller("LAWYER").clearOrgDefault({ key: "list.contacts" })).rejects.toThrow(TRPCError);
  });
});

describe("prefs.clear", () => {
  it("no-op när det inte finns ngn user-pref", async () => {
    mockPrisma.userPreference.findFirst.mockResolvedValue(null);
    expect(await makeCaller().clear({ key: "list.x" })).toEqual({ ok: true });
    expect(mockPrisma.userPreference.delete).not.toHaveBeenCalled();
  });

  it("raderar när den finns", async () => {
    mockPrisma.userPreference.findFirst.mockResolvedValue({ id: "p1" });
    await makeCaller().clear({ key: "list.x" });
    expect(mockPrisma.userPreference.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });
});
