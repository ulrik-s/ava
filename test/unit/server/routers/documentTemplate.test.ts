import { TRPCError } from "@trpc/server";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentTemplateRouter } from "@/lib/server/routers/documentTemplate";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

// ─── Helpers ─────────────────────────────────────────────────────

/** Build a caller with a given org context. */
function makeCaller(orgId = "org-a") {
  const dataStore = dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>);
  const ctx = {
    user: { id: "user-1", email: "a@b.com", name: "Test", role: "ADMIN", organizationId: orgId },
    prisma: mockPrisma, dataStore,
    repos: buildInMemoryRepositories(dataStore as unknown as IDataStore),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return documentTemplateRouter.createCaller(ctx as any);
}

const TEMPLATE_A = {
  id: "tpl-1",
  name: "Uppdragsavtal",
  description: "Standardavtal",
  category: "Avtal",
  content: "<h1>{{matter.title}}</h1>",
  organizationId: "org-a",
  createdById: "user-1",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  createdBy: { name: "Test" },
};

const mockPrisma = {
  documentTemplate: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list ─────────────────────────────────────────────────────────

describe("documentTemplate.list", () => {
  it("returns templates scoped to the caller's organisation", async () => {
    mockPrisma.documentTemplate.findMany.mockResolvedValue([TEMPLATE_A]);
    const result = await makeCaller("org-a").list();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Uppdragsavtal");
  });

  it("queries with the correct organizationId filter", async () => {
    mockPrisma.documentTemplate.findMany.mockResolvedValue([]);
    await makeCaller("org-x").list();
    expect(mockPrisma.documentTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-x" } })
    );
  });

  it("orders results by category then name", async () => {
    mockPrisma.documentTemplate.findMany.mockResolvedValue([]);
    await makeCaller().list();
    expect(mockPrisma.documentTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ category: "asc" }, { name: "asc" }],
      })
    );
  });

  it("returns an empty array when no templates exist", async () => {
    mockPrisma.documentTemplate.findMany.mockResolvedValue([]);
    const result = await makeCaller().list();
    expect(result).toEqual([]);
  });
});

// ─── getById ─────────────────────────────────────────────────────

describe("documentTemplate.getById", () => {
  it("returns the template when it belongs to the caller's org", async () => {
    mockPrisma.documentTemplate.findFirst.mockResolvedValue(TEMPLATE_A);
    const result = await makeCaller("org-a").getById({ id: "tpl-1" });
    expect(result.id).toBe("tpl-1");
    expect(result.content).toBe("<h1>{{matter.title}}</h1>");
  });

  it("throws NOT_FOUND when template doesn't exist", async () => {
    mockPrisma.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(makeCaller().getById({ id: "tpl-999" })).rejects.toThrow(TRPCError);
  });

  it("throws NOT_FOUND when template belongs to a different org", async () => {
    // getByIdInOrg org-scopar via where → annan org ger ingen träff (null).
    mockPrisma.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(makeCaller("org-a").getById({ id: "tpl-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ─── create ──────────────────────────────────────────────────────

describe("documentTemplate.create", () => {
  it("creates a template in the caller's org", async () => {
    mockPrisma.documentTemplate.create.mockResolvedValue(TEMPLATE_A);
    await makeCaller("org-a").create({
      name: "Uppdragsavtal",
      content: "<h1>{{matter.title}}</h1>",
    });
    expect(mockPrisma.documentTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          createdById: "user-1",
          name: "Uppdragsavtal",
        }),
      })
    );
  });

  it("stores optional category and description", async () => {
    mockPrisma.documentTemplate.create.mockResolvedValue(TEMPLATE_A);
    await makeCaller().create({
      name: "Test",
      content: "<p>test</p>",
      category: "Avtal",
      description: "Kort beskrivning",
    });
    expect(mockPrisma.documentTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: "Avtal", description: "Kort beskrivning" }),
      })
    );
  });

  it("rejects empty name", async () => {
    await expect(
      makeCaller().create({ name: "", content: "<p>x</p>" })
    ).rejects.toThrow();
  });

  it("rejects empty content", async () => {
    await expect(
      makeCaller().create({ name: "Test", content: "" })
    ).rejects.toThrow();
  });
});

// ─── update ──────────────────────────────────────────────────────

describe("documentTemplate.update", () => {
  it("updates a template that belongs to the caller's org", async () => {
    mockPrisma.documentTemplate.findFirst.mockResolvedValue({ organizationId: "org-a" });
    mockPrisma.documentTemplate.update.mockResolvedValue({ ...TEMPLATE_A, name: "Nytt namn" });

    const result = await makeCaller("org-a").update({ id: "tpl-1", name: "Nytt namn" });
    expect(result.name).toBe("Nytt namn");
    expect(mockPrisma.documentTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tpl-1" } })
    );
  });

  it("throws NOT_FOUND when updating a template from another org", async () => {
    mockPrisma.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller("org-a").update({ id: "tpl-1", name: "Hacked" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.documentTemplate.update).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when template does not exist", async () => {
    mockPrisma.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().update({ id: "tpl-999", name: "Ghost" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── delete ──────────────────────────────────────────────────────

describe("documentTemplate.delete", () => {
  it("deletes a template that belongs to the caller's org", async () => {
    mockPrisma.documentTemplate.findFirst.mockResolvedValue({ organizationId: "org-a" });
    mockPrisma.documentTemplate.delete.mockResolvedValue(TEMPLATE_A);

    await makeCaller("org-a").delete({ id: "tpl-1" });
    expect(mockPrisma.documentTemplate.delete).toHaveBeenCalledWith({ where: { id: "tpl-1" } });
  });

  it("throws NOT_FOUND when trying to delete from another org", async () => {
    mockPrisma.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(makeCaller("org-a").delete({ id: "tpl-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockPrisma.documentTemplate.delete).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when template does not exist", async () => {
    mockPrisma.documentTemplate.findFirst.mockResolvedValue(null);
    await expect(makeCaller().delete({ id: "tpl-999" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
