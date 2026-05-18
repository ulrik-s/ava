/**
 * Test för conflictRouter — javskontroll mot personnummer + namn (trigram).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { conflictRouter } from "@/server/routers/conflict";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  matterContact: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  conflictCheck: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  $queryRaw: vi.fn(),
};

function makeCaller(orgId = "org-a", userId = "u1") {
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return conflictRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.matterContact.findMany.mockResolvedValue([]);
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.conflictCheck.create.mockResolvedValue({});
  mockPrisma.conflictCheck.findMany.mockResolvedValue([]);
  mockPrisma.conflictCheck.count.mockResolvedValue(0);
  mockPrisma.matterContact.findFirst.mockResolvedValue(null);
});

describe("conflict.check", () => {
  it("hittar kontakter via personnummer-substring", async () => {
    mockPrisma.matterContact.findMany.mockResolvedValue([
      {
        role: "MOTPART",
        contact: {
          id: "c1", name: "Anna", contactType: "PERSON",
          personalNumber: "19850225-6655", orgNumber: null,
        },
        matter: {
          id: "m1", matterNumber: "2026-0001", title: "X",
          contacts: [{ contact: { name: "Klient Klientsson" } }],
        },
      },
    ]);

    const res = await makeCaller().check({
      searchTerm: "19850225",
      searchType: "personalNumber",
    });
    expect(res.matchCount).toBe(1);
    expect(res.results[0].contactName).toBe("Anna");
    expect(res.results[0].klient).toBe("Klient Klientsson");
  });

  it("hittar kontakter via fuzzy namn-sökning (trigram)", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        contact_id: "c1", contact_name: "Anna Andersson", contact_type: "PERSON",
        personal_number: null, org_number: null,
        matter_id: "m1", matter_number: "2026-0001", matter_title: "X",
        role: "MOTPART", similarity: 0.8,
      },
    ]);
    mockPrisma.matterContact.findFirst.mockResolvedValue({
      contact: { name: "Klienten" },
    });

    const res = await makeCaller().check({
      searchTerm: "Ana",
      searchType: "name",
    });
    expect(res.matchCount).toBe(1);
    expect(res.results[0].contactName).toBe("Anna Andersson");
  });

  it("kombinerar både searchTypes utan dubblettrader", async () => {
    // Samma kontakt+ärende+roll dyker upp i båda sökningarna — ska bara räknas en gång
    mockPrisma.matterContact.findMany.mockResolvedValue([
      {
        role: "MOTPART",
        contact: { id: "c1", name: "X", contactType: "PERSON", personalNumber: "1", orgNumber: null },
        matter: { id: "m1", matterNumber: "0001", title: "Y", contacts: [] },
      },
    ]);
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        contact_id: "c1", contact_name: "X", contact_type: "PERSON",
        personal_number: "1", org_number: null,
        matter_id: "m1", matter_number: "0001", matter_title: "Y",
        role: "MOTPART", similarity: 0.9,
      },
    ]);

    const res = await makeCaller().check({ searchTerm: "X", searchType: "both" });
    expect(res.matchCount).toBe(1);
  });

  it("loggar varje sökning till conflictCheck", async () => {
    await makeCaller().check({ searchTerm: "test" });
    expect(mockPrisma.conflictCheck.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          searchTerm: "test",
          checkedById: "u1",
        }),
      }),
    );
  });

  it("kräver searchTerm min(1)", async () => {
    await expect(makeCaller().check({ searchTerm: "" })).rejects.toThrow();
  });

  it("scopar via matter.organizationId i personnummer-sökning", async () => {
    await makeCaller("my-org").check({ searchTerm: "X", searchType: "personalNumber" });
    expect(mockPrisma.matterContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matter: { organizationId: "my-org" },
        }),
      }),
    );
  });
});

describe("conflict.history", () => {
  it("returnerar paginerad historik", async () => {
    mockPrisma.conflictCheck.findMany.mockResolvedValue([{ id: "ck1" }]);
    mockPrisma.conflictCheck.count.mockResolvedValue(1);
    const res = await makeCaller().history({ page: 1, pageSize: 20 });
    expect(res.checks).toHaveLength(1);
    expect(res.pages).toBe(1);
  });
});
