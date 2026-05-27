/**
 * Integrationstest för matterRouter.
 *
 * Mockar prisma-klienten och kör routern via createCaller. Täcker:
 *   - list:           pagination, status-filter, sökning, org-scoping
 *   - getById:        normalt fall + cross-org NOT_FOUND
 *   - create:         autogenerering av matterNumber, klient-koppling
 *   - update:         status, paymentMethod, paymentMethodDecidedAt-konvertering
 *   - addContact:     normal + cross-org spärr
 *   - addNewContact:  återanvändning av befintlig kontakt + skapande
 *   - removeContact:  normal + cross-org spärr
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { matterRouter } from "@/lib/server/routers/matter";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  matter: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  contact: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  matterContact: {
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(orgId = "org-a", userId = "user-1") {
  const ctx = {
    user: { id: userId, email: "a@b.com", name: "Test", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return matterRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

const MATTER_A = {
  id: "matter-1",
  organizationId: "org-a",
  matterNumber: "2026-0001",
  title: "Bodelning",
};

// ─── list ────────────────────────────────────────────────────────

describe("matter.list", () => {
  it("returnerar paginerat resultat", async () => {
    mockPrisma.matter.findMany.mockResolvedValue([MATTER_A]);
    mockPrisma.matter.count.mockResolvedValue(1);

    const res = await makeCaller().list({ page: 1, pageSize: 20 });
    expect(res.matters).toHaveLength(1);
    expect(res.total).toBe(1);
    expect(res.pages).toBe(1);
  });

  it("scopar alltid på organizationId", async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.matter.count.mockResolvedValue(0);

    await makeCaller("org-a").list({});
    expect(mockPrisma.matter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-a" }),
      }),
    );
  });

  it("filtrerar på status när angivet", async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.matter.count.mockResolvedValue(0);

    await makeCaller().list({ status: "ACTIVE" });
    expect(mockPrisma.matter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
  });

  it("filtrerar på medarbetare (tidsposter) när employeeId angivet", async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.matter.count.mockResolvedValue(0);

    await makeCaller().list({ employeeId: "u-bjorn" });
    expect(mockPrisma.matter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          timeEntries: { some: { userId: "u-bjorn" } },
        }),
      }),
    );
  });

  it("utelämnar timeEntries-filter när employeeId saknas", async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.matter.count.mockResolvedValue(0);

    await makeCaller().list({});
    const where = mockPrisma.matter.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("timeEntries");
  });

  it("bygger OR-sökning på title/matterNumber/contacts", async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.matter.count.mockResolvedValue(0);

    await makeCaller().list({ search: "Berg" });
    const callArgs = mockPrisma.matter.findMany.mock.calls[0][0];
    expect(callArgs.where.OR).toBeDefined();
    expect(callArgs.where.OR).toHaveLength(3);
  });

  it("räknar pages korrekt vid total > pageSize", async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.matter.count.mockResolvedValue(45);

    const res = await makeCaller().list({ pageSize: 20 });
    expect(res.pages).toBe(3); // ceil(45/20)
  });

  it("validerar pageSize-gränser via zod", async () => {
    await expect(makeCaller().list({ pageSize: 600 })).rejects.toThrow(); // max 500
    await expect(makeCaller().list({ page: 0 })).rejects.toThrow();
  });
});

// ─── getById ─────────────────────────────────────────────────────

describe("matter.getById", () => {
  it("hämtar matter med kontakter + counts", async () => {
    mockPrisma.matter.findFirstOrThrow.mockResolvedValue(MATTER_A);
    const res = await makeCaller().getById({ id: "matter-1" });
    expect(res).toEqual(MATTER_A);
    expect(mockPrisma.matter.findFirstOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "matter-1", organizationId: "org-a" },
      }),
    );
  });

  it("kastar när matter saknas / fel org", async () => {
    mockPrisma.matter.findFirstOrThrow.mockRejectedValue(new Error("not found"));
    await expect(makeCaller().getById({ id: "x" })).rejects.toThrow();
  });
});

// ─── create ──────────────────────────────────────────────────────

describe("matter.create", () => {
  it("skapar nytt matter med matterNumber när inga finns", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    mockPrisma.matter.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "new",
    }));

    const year = new Date().getFullYear();
    const res = await makeCaller().create({ title: "Nytt" });
    expect(res.matterNumber).toBe(`${year}-0001`);
  });

  it("ökar serienumret från senaste matter", async () => {
    const year = new Date().getFullYear();
    mockPrisma.matter.findFirst.mockResolvedValue({
      matterNumber: `${year}-0042`,
    });
    mockPrisma.matter.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "new",
    }));

    const res = await makeCaller().create({ title: "T" });
    expect(res.matterNumber).toBe(`${year}-0043`);
  });

  it("kopplar klient när klientId angivits", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    mockPrisma.matter.create.mockResolvedValue({ id: "matter-1", organizationId: "org-a" });
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "c1", organizationId: "org-a" });
    mockPrisma.matterContact.create.mockResolvedValue({});

    await makeCaller().create({ title: "T", klientId: "c1" });
    expect(mockPrisma.matterContact.create).toHaveBeenCalledWith({
      data: { matterId: "matter-1", contactId: "c1", role: "KLIENT" },
    });
  });

  it("vägrar att koppla klient från annan org", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    mockPrisma.matter.create.mockResolvedValue({ id: "matter-1", organizationId: "org-a" });
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "c1", organizationId: "org-b" });

    await expect(
      makeCaller("org-a").create({ title: "T", klientId: "c1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.matterContact.create).not.toHaveBeenCalled();
  });

  it("kräver title (zod min(1))", async () => {
    await expect(makeCaller().create({ title: "" })).rejects.toThrow();
  });
});

// ─── update ──────────────────────────────────────────────────────

describe("matter.update", () => {
  it("uppdaterar status", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue(MATTER_A);
    mockPrisma.matter.update.mockResolvedValue({ ...MATTER_A, status: "CLOSED" });

    await makeCaller().update({ id: "matter-1", status: "CLOSED" });
    expect(mockPrisma.matter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "matter-1" },
        data: expect.objectContaining({ status: "CLOSED" }),
      }),
    );
  });

  it("konverterar paymentMethodDecidedAt-sträng till Date", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue(MATTER_A);
    mockPrisma.matter.update.mockResolvedValue(MATTER_A);

    await makeCaller().update({
      id: "matter-1",
      paymentMethod: "RATTSHJALP",
      paymentMethodDecidedAt: "2026-03-02",
    });
    const args = mockPrisma.matter.update.mock.calls[0][0];
    expect(args.data.paymentMethodDecidedAt).toBeInstanceOf(Date);
    expect((args.data.paymentMethodDecidedAt as Date).toISOString()).toContain("2026-03-02");
  });

  it("nullar paymentMethodDecidedAt när tom sträng/null", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue(MATTER_A);
    mockPrisma.matter.update.mockResolvedValue(MATTER_A);

    await makeCaller().update({ id: "matter-1", paymentMethodDecidedAt: null });
    const args = mockPrisma.matter.update.mock.calls[0][0];
    expect(args.data.paymentMethodDecidedAt).toBeNull();
  });

  it("vägrar uppdatera matter från annan org", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue({ id: "x", organizationId: "org-b" });

    await expect(
      makeCaller("org-a").update({ id: "x", status: "CLOSED" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.matter.update).not.toHaveBeenCalled();
  });
});

// ─── addContact ──────────────────────────────────────────────────

describe("matter.addContact", () => {
  it("kopplar befintlig kontakt", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue(MATTER_A);
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "c1", organizationId: "org-a" });
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc1" });

    await makeCaller().addContact({
      matterId: "matter-1",
      contactId: "c1",
      role: "MOTPART",
    });
    expect(mockPrisma.matterContact.create).toHaveBeenCalled();
  });

  it("vägrar koppla matter från annan org", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue({ id: "x", organizationId: "org-b" });

    await expect(
      makeCaller("org-a").addContact({
        matterId: "x",
        contactId: "c1",
        role: "MOTPART",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("vägrar koppla kontakt från annan org", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue(MATTER_A);
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "c1",
      organizationId: "org-b",
    });

    await expect(
      makeCaller("org-a").addContact({
        matterId: "matter-1",
        contactId: "c1",
        role: "MOTPART",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── addNewContact ───────────────────────────────────────────────

describe("matter.addNewContact", () => {
  it("återanvänder befintlig kontakt med samma personnummer", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue(MATTER_A);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "existing", organizationId: "org-a" });
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc1" });

    await makeCaller().addNewContact({
      matterId: "matter-1",
      name: "Test Person",
      contactType: "PERSON",
      personalNumber: "19850225-6655",
      role: "MOTPART",
    });
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    expect(mockPrisma.matterContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "existing" }),
      }),
    );
  });

  it("skapar ny kontakt när ingen matchar", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue(MATTER_A);
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.contact.create.mockResolvedValue({ id: "new", name: "Ny" });
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc1" });

    await makeCaller().addNewContact({
      matterId: "matter-1",
      name: "Ny",
      contactType: "PERSON",
      role: "MOTPART",
    });
    expect(mockPrisma.contact.create).toHaveBeenCalled();
    expect(mockPrisma.matterContact.create).toHaveBeenCalled();
  });

  it("matchar på orgnummer för företag", async () => {
    mockPrisma.matter.findUnique.mockResolvedValue(MATTER_A);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "co", organizationId: "org-a" });
    mockPrisma.matterContact.create.mockResolvedValue({});

    await makeCaller().addNewContact({
      matterId: "matter-1",
      name: "AB",
      contactType: "COMPANY",
      orgNumber: "556677-8899",
      role: "MOTPART",
    });
    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgNumber: "556677-8899" }),
      }),
    );
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
  });
});

// ─── removeContact ───────────────────────────────────────────────

describe("matter.removeContact", () => {
  it("tar bort koppling med korrekt org-scoping", async () => {
    mockPrisma.matterContact.findUnique.mockResolvedValue({
      id: "mc1",
      matter: { organizationId: "org-a" },
    });
    mockPrisma.matterContact.delete.mockResolvedValue({});

    await makeCaller().removeContact({ matterContactId: "mc1" });
    expect(mockPrisma.matterContact.delete).toHaveBeenCalledWith({
      where: { id: "mc1" },
    });
  });

  it("vägrar ta bort koppling från annan org", async () => {
    mockPrisma.matterContact.findUnique.mockResolvedValue({
      id: "mc1",
      matter: { organizationId: "org-b" },
    });
    await expect(
      makeCaller("org-a").removeContact({ matterContactId: "mc1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.matterContact.delete).not.toHaveBeenCalled();
  });
});
