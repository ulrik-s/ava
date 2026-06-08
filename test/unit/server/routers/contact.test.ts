/**
 * Test för contactRouter — list/getById/create/update/delete/addChild
 * med org-scoping och epost-validering.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { contactRouter } from "@/lib/server/routers/contact";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  contact: {
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "u", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return contactRouter.createCaller(ctx as any);
}

beforeEach(() => vi.clearAllMocks());

const C = { id: "c1", organizationId: "org-a", name: "X" };

describe("contact.list", () => {
  beforeEach(() => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.contact.count.mockResolvedValue(0);
  });

  it("filtrerar bort under-kontakter (parentId: null)", async () => {
    await makeCaller().list({});
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ parentId: null }),
      }),
    );
  });

  it("filtrerar på contactType när angivet", async () => {
    await makeCaller().list({ contactType: "COURT" });
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contactType: "COURT" }),
      }),
    );
  });

  it("bygger OR-sökning på namn/personnr/orgnr/epost", async () => {
    await makeCaller().list({ search: "Anna" });
    const args = mockPrisma.contact.findMany.mock.calls[0]![0];
    expect(args.where.OR).toHaveLength(4);
  });

  it("scopar på organizationId", async () => {
    await makeCaller("org-x").list({});
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-x" }),
      }),
    );
  });
});

describe("contact.getById", () => {
  it("hämtar med org-scope och inkluderar relationer", async () => {
    mockPrisma.contact.findFirstOrThrow.mockResolvedValue(C);
    await makeCaller().getById({ id: "c1" });
    expect(mockPrisma.contact.findFirstOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", organizationId: "org-a" },
        include: expect.objectContaining({
          matterLinks: expect.any(Object),
          children: expect.any(Object),
        }),
      }),
    );
  });
});

describe("contact.create", () => {
  it("skapar kontakt och nullar tom epost-sträng", async () => {
    mockPrisma.contact.create.mockResolvedValue(C);
    await makeCaller().create({
      name: "Ny",
      contactType: "PERSON",
      email: "",
    });
    const args = mockPrisma.contact.create.mock.calls[0]![0];
    expect(args.data.email).toBeNull();
  });

  it("validerar epost-format", async () => {
    await expect(
      makeCaller().create({ name: "X", contactType: "PERSON", email: "inte-epost" }),
    ).rejects.toThrow();
  });

  it("kräver namn min(1)", async () => {
    await expect(
      makeCaller().create({ name: "", contactType: "PERSON" }),
    ).rejects.toThrow();
  });
});

describe("contact.update", () => {
  it("uppdaterar med org-scope", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(C);
    mockPrisma.contact.update.mockResolvedValue(C);

    await makeCaller().update({ id: "c1", name: "Nytt" });
    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({ name: "Nytt" }),
      }),
    );
  });

  it("vägrar uppdatera kontakt från annan org", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "c1", organizationId: "org-b" });
    await expect(
      makeCaller("org-a").update({ id: "c1", name: "X" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.contact.update).not.toHaveBeenCalled();
  });
});

describe("contact.delete", () => {
  it("tar bort med org-scope", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(C);
    mockPrisma.contact.delete.mockResolvedValue(C);
    await makeCaller().delete({ id: "c1" });
    expect(mockPrisma.contact.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("vägrar ta bort kontakt från annan org", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "c1", organizationId: "org-b" });
    await expect(
      makeCaller("org-a").delete({ id: "c1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("contact.addChild", () => {
  it("lägger till child-kontakt under parent", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(C);
    mockPrisma.contact.create.mockResolvedValue({ id: "child" });
    await makeCaller().addChild({ parentId: "c1", name: "Anställd" });
    const args = mockPrisma.contact.create.mock.calls[0]![0];
    expect(args.data.parentId).toBe("c1");
    expect(args.data.contactType).toBe("PERSON");
    expect(args.data.organizationId).toBe("org-a");
  });

  it("vägrar lägga child under förälder från annan org", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "c1", organizationId: "org-b" });
    await expect(
      makeCaller("org-a").addChild({ parentId: "c1", name: "X" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
