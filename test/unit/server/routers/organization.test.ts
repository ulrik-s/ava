import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { organizationRouter } from "@/lib/server/routers/organization";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

// ─── Helpers ─────────────────────────────────────────────────────

const mockPrisma = {
  organization: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  office: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "user-1", email: "a@b.com", name: "Test", role: "ADMIN", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return organizationRouter.createCaller(ctx as any);
}

const MAIN_OFFICE = {
  id: "off-main",
  name: "Stockholm",
  address: "Storgatan 1, 111 23 Stockholm",
  phone: "08-123 456 78",
  email: "sthlm@byrå.se",
  isMain: true,
  organizationId: "org-a",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const BRANCH_OFFICE = {
  id: "off-branch",
  name: "Göteborg",
  address: "Avenyn 10, 411 36 Göteborg",
  phone: "031-987 65 43",
  email: "gbg@byrå.se",
  isMain: false,
  organizationId: "org-a",
  createdAt: new Date("2024-02-01"),
  updatedAt: new Date("2024-02-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Register main office + branch office ───────────────────────

describe("organization.addOffice — registrera huvudkontor och filial", () => {
  it("registrerar ett huvudkontor (isMain: true)", async () => {
    mockPrisma.office.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.office.create.mockResolvedValue(MAIN_OFFICE);

    const result = await makeCaller("org-a").addOffice({
      name: "Stockholm",
      address: "Storgatan 1, 111 23 Stockholm",
      phone: "08-123 456 78",
      email: "sthlm@byrå.se",
      isMain: true,
    });

    expect(result.isMain).toBe(true);
    expect(result.name).toBe("Stockholm");
    expect(mockPrisma.office.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Stockholm",
          isMain: true,
          organizationId: "org-a",
        }),
      })
    );
  });

  it("degraderar tidigare huvudkontor när nytt huvudkontor skapas", async () => {
    mockPrisma.office.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.office.create.mockResolvedValue(MAIN_OFFICE);

    await makeCaller("org-a").addOffice({
      name: "Stockholm",
      address: "Storgatan 1",
      isMain: true,
    });

    // Existing mains should be demoted before the new main is created
    expect(mockPrisma.office.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", isMain: true },
      data: { isMain: false },
    });
    expect(mockPrisma.office.create).toHaveBeenCalled();
  });

  it("registrerar en filial (isMain: false) utan att påverka huvudkontor", async () => {
    mockPrisma.office.create.mockResolvedValue(BRANCH_OFFICE);

    const result = await makeCaller("org-a").addOffice({
      name: "Göteborg",
      address: "Avenyn 10, 411 36 Göteborg",
      phone: "031-987 65 43",
      email: "gbg@byrå.se",
      isMain: false,
    });

    expect(result.isMain).toBe(false);
    expect(result.name).toBe("Göteborg");
    // Since isMain is false, no demotion should happen
    expect(mockPrisma.office.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.office.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Göteborg",
          isMain: false,
          organizationId: "org-a",
        }),
      })
    );
  });

  it("defaultar isMain till false när det utelämnas", async () => {
    mockPrisma.office.create.mockResolvedValue(BRANCH_OFFICE);

    await makeCaller("org-a").addOffice({ name: "Malmö" });

    expect(mockPrisma.office.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.office.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Malmö", isMain: false }),
      })
    );
  });

  it("tilldelar alltid anropande användarens organizationId", async () => {
    mockPrisma.office.create.mockResolvedValue({ ...BRANCH_OFFICE, organizationId: "org-x" });

    await makeCaller("org-x").addOffice({ name: "Uppsala" });

    expect(mockPrisma.office.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-x" }),
      })
    );
  });

  it("avvisar tomt namn", async () => {
    await expect(makeCaller().addOffice({ name: "" })).rejects.toThrow();
    expect(mockPrisma.office.create).not.toHaveBeenCalled();
  });
});

// ─── Full flow: main + branch ────────────────────────────────────

describe("organization — komplett flöde: registrera huvudkontor och filial", () => {
  it("registrerar först huvudkontor och sedan en filial", async () => {
    // Step 1: create main office (no existing offices → demotion affects 0 rows)
    mockPrisma.office.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.office.create.mockResolvedValueOnce(MAIN_OFFICE);

    const main = await makeCaller("org-a").addOffice({
      name: "Stockholm",
      address: "Storgatan 1, 111 23 Stockholm",
      isMain: true,
    });

    expect(main.isMain).toBe(true);
    expect(main.name).toBe("Stockholm");

    // Step 2: create branch office
    mockPrisma.office.create.mockResolvedValueOnce(BRANCH_OFFICE);

    const branch = await makeCaller("org-a").addOffice({
      name: "Göteborg",
      address: "Avenyn 10, 411 36 Göteborg",
      isMain: false,
    });

    expect(branch.isMain).toBe(false);
    expect(branch.name).toBe("Göteborg");

    // Step 3: listOffices should return both, main first
    mockPrisma.office.findMany.mockResolvedValue([MAIN_OFFICE, BRANCH_OFFICE]);
    const list = await makeCaller("org-a").listOffices();

    expect(list).toHaveLength(2);
    expect(list[0].isMain).toBe(true);
    expect(list[0].name).toBe("Stockholm");
    expect(list[1].isMain).toBe(false);
    expect(list[1].name).toBe("Göteborg");

    // Verify the query filters on org and orders by isMain desc, then name asc
    expect(mockPrisma.office.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a" },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
    });
  });
});

// ─── updateOffice ────────────────────────────────────────────────

describe("organization.updateOffice", () => {
  it("uppdaterar ett kontor i anropande organisation", async () => {
    mockPrisma.office.findUnique.mockResolvedValue(BRANCH_OFFICE);
    mockPrisma.office.update.mockResolvedValue({ ...BRANCH_OFFICE, phone: "031-000 00 00" });

    const result = await makeCaller("org-a").updateOffice({
      id: "off-branch",
      phone: "031-000 00 00",
    });

    expect(result.phone).toBe("031-000 00 00");
    expect(mockPrisma.office.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "off-branch" } })
    );
  });

  it("degraderar tidigare huvudkontor när en filial befordras", async () => {
    mockPrisma.office.findUnique.mockResolvedValue(BRANCH_OFFICE);
    mockPrisma.office.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.office.update.mockResolvedValue({ ...BRANCH_OFFICE, isMain: true });

    await makeCaller("org-a").updateOffice({ id: "off-branch", isMain: true });

    expect(mockPrisma.office.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", isMain: true },
      data: { isMain: false },
    });
  });

  it("kastar NOT_FOUND när kontor tillhör annan organisation", async () => {
    mockPrisma.office.findUnique.mockResolvedValue({ ...BRANCH_OFFICE, organizationId: "org-b" });

    await expect(
      makeCaller("org-a").updateOffice({ id: "off-branch", name: "Hijacked" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.office.update).not.toHaveBeenCalled();
  });

  it("kastar NOT_FOUND när kontor inte existerar", async () => {
    mockPrisma.office.findUnique.mockResolvedValue(null);

    await expect(
      makeCaller("org-a").updateOffice({ id: "off-ghost", name: "X" })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

// ─── deleteOffice ────────────────────────────────────────────────

describe("organization.deleteOffice", () => {
  it("tar bort ett kontor i anropande organisation", async () => {
    mockPrisma.office.findUnique.mockResolvedValue(BRANCH_OFFICE);
    mockPrisma.office.delete.mockResolvedValue(BRANCH_OFFICE);

    await makeCaller("org-a").deleteOffice({ id: "off-branch" });

    expect(mockPrisma.office.delete).toHaveBeenCalledWith({ where: { id: "off-branch" } });
  });

  it("kastar NOT_FOUND vid borttagning från annan organisation", async () => {
    mockPrisma.office.findUnique.mockResolvedValue({ ...BRANCH_OFFICE, organizationId: "org-b" });

    await expect(makeCaller("org-a").deleteOffice({ id: "off-branch" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockPrisma.office.delete).not.toHaveBeenCalled();
  });
});

// ─── getSettings / updateSettings ────────────────────────────────

describe("organization.getSettings", () => {
  it("returnerar org-inställningar för anropande användares org", async () => {
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({
      id: "org-a",
      name: "Advokat AB",
      orgNumber: "556123-4567",
      address: "Storgatan 1",
      phone: "08-123 456 78",
      email: "info@byrå.se",
      bankgiro: "123-4567",
      logoPath: null,
    });

    const result = await makeCaller("org-a").getSettings();

    expect(result.name).toBe("Advokat AB");
    expect(result.bankgiro).toBe("123-4567");
    expect(mockPrisma.organization.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-a" } })
    );
  });
});

describe("organization.updateSettings", () => {
  it("uppdaterar bankgiro och övriga fält", async () => {
    mockPrisma.organization.update.mockResolvedValue({
      id: "org-a",
      name: "Advokat AB",
      bankgiro: "999-8888",
    });

    await makeCaller("org-a").updateSettings({ bankgiro: "999-8888" });

    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-a" },
      data: { bankgiro: "999-8888" },
    });
  });
});
