/**
 * Tester för taskRouter — CRUD + complete + auto-completedAt-hantering.
 * Migrerad till repository-sömmen (ADR 0020): ägar-vakt via getOwned (findFirst).
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { taskRouter } from "@/lib/server/routers/task";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  task: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(userId = "u1", orgId = "org-a") {
  const dataStore = dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>);
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    dataStore,
    repos: buildInMemoryRepositories(dataStore as unknown as IDataStore),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return taskRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.task.findMany.mockResolvedValue([]);
});

describe("task.list", () => {
  it("scopar till user + org", async () => {
    await makeCaller("u-anna", "org-x").list();
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u-anna", organizationId: "org-x" },
      }),
    );
  });

  it("filtrerar på status", async () => {
    await makeCaller().list({ status: "DONE" });
    const arg = mockPrisma.task.findMany.mock.calls[0]![0] as { where: { status: string } };
    expect(arg.where.status).toBe("DONE");
  });

  it("filtrerar på matterId", async () => {
    await makeCaller().list({ matterId: "m-1" });
    const arg = mockPrisma.task.findMany.mock.calls[0]![0] as { where: { matterId: string } };
    expect(arg.where.matterId).toBe("m-1");
  });
});

describe("task.create", () => {
  it("defaultar status=TODO + priority=MEDIUM", async () => {
    mockPrisma.task.create.mockResolvedValue({ id: "t-1" });
    await makeCaller("u-anna", "org-x").create({ title: "Ring klienten" });
    expect(mockPrisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Ring klienten",
          status: "TODO",
          priority: "MEDIUM",
          userId: "u-anna",
          organizationId: "org-x",
        }),
      }),
    );
  });

  it("kräver title min(1)", async () => {
    await expect(makeCaller().create({ title: "" })).rejects.toThrow();
  });
});

describe("task.update", () => {
  it("guardar ownership (NOT_FOUND när ej ägd)", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    await expect(makeCaller().update({ id: "t-1", title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("sätter completedAt när status=DONE", async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: "t-1" });
    mockPrisma.task.update.mockResolvedValue({});
    await makeCaller().update({ id: "t-1", status: "DONE" });
    const arg = mockPrisma.task.update.mock.calls[0]![0] as { data: { completedAt: Date } };
    expect(arg.data.completedAt).toBeInstanceOf(Date);
  });

  it("nollställer completedAt när status flippas till TODO", async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: "t-1" });
    mockPrisma.task.update.mockResolvedValue({});
    await makeCaller().update({ id: "t-1", status: "TODO" });
    const arg = mockPrisma.task.update.mock.calls[0]![0] as { data: { completedAt: Date | null } };
    expect(arg.data.completedAt).toBeNull();
  });
});

describe("task.complete", () => {
  it("convenience-mutation — status=DONE + completedAt=now", async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: "t-1" });
    mockPrisma.task.update.mockResolvedValue({});
    await makeCaller().complete({ id: "t-1" });
    const arg = mockPrisma.task.update.mock.calls[0]![0] as { data: { status: string; completedAt: Date } };
    expect(arg.data.status).toBe("DONE");
    expect(arg.data.completedAt).toBeInstanceOf(Date);
  });

  it("guardar ownership (NOT_FOUND när ej ägd)", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    await expect(makeCaller().complete({ id: "t-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("task.delete", () => {
  it("guardar ownership + hård delete", async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: "t-1" });
    mockPrisma.task.delete.mockResolvedValue({});
    await makeCaller().delete({ id: "t-1" });
    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: "t-1" } });
  });

  it("guardar ownership (NOT_FOUND när ej ägd)", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    await expect(makeCaller().delete({ id: "t-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.task.delete).not.toHaveBeenCalled();
  });
});
