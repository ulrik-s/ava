/**
 * Test för serviceNoteRouter (#348/#375) — list + create + update + delete.
 * list org-scopas via matter.organizationId; create sätter authorId + org
 * från context; update/delete ägarkollar via matter (findFirst) → NOT_FOUND.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { serviceNoteRouter } from "@/lib/server/routers/serviceNote";
import { dataStoreFromMockPrisma, reposFromMockDataStore } from "../helpers/mock-data-store";

const mockPrisma = {
  matter: { findFirst: vi.fn() },
  serviceNote: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(orgId = "org-a", userId = "u1", role: "ADMIN" | "LAWYER" = "LAWYER", queued = false) {
  const dataStore = dataStoreFromMockPrisma(mockPrisma);
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role, organizationId: orgId },
    prisma: mockPrisma, dataStore,
    repos: reposFromMockDataStore(dataStore),
    ...(queued ? { queued: { mutationId: "q-1", at: Date.UTC(2026, 9, 1) } } : {}),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return serviceNoteRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.matter.findFirst.mockResolvedValue({ id: "m1", organizationId: "org-a" });
  mockPrisma.serviceNote.findMany.mockResolvedValue([]);
  mockPrisma.serviceNote.create.mockResolvedValue({ id: "sn1" });
  mockPrisma.serviceNote.findFirst.mockResolvedValue({ id: "sn1" });
  mockPrisma.serviceNote.update.mockResolvedValue({ id: "sn1" });
  mockPrisma.serviceNote.delete.mockResolvedValue({ id: "sn1" });
});

describe("serviceNote.list", () => {
  it("scopar via matter.organizationId + matterId och inkluderar author", async () => {
    await makeCaller("org-a").list({ matterId: "m1" });
    expect(mockPrisma.serviceNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matterId: "m1", matter: { organizationId: "org-a" } },
        include: { author: { select: { id: true, name: true } } },
      }),
    );
  });
});

describe("serviceNote.create", () => {
  it("sätter authorId + organizationId från context och skickar date/time/text", async () => {
    await makeCaller("org-a", "u-9").create({
      matterId: "m1", date: "2026-06-15", time: "09:30", text: "Samtal",
    });
    const data = mockPrisma.serviceNote.create.mock.calls[0]![0].data;
    expect(data.authorId).toBe("u-9");
    expect(data.organizationId).toBe("org-a");
    expect(data.matterId).toBe("m1");
    expect(data.date).toBe("2026-06-15");
    expect(data.time).toBe("09:30");
    expect(data.text).toBe("Samtal");
  });

  it("datum måste vara YYYY-MM-DD och klockslag HH:mm — en ISO-tidpunkt visades rått i listan (#1309)", async () => {
    await expect(
      makeCaller().create({ matterId: "m1", date: "2026-09-11T09:00:00.000Z", time: "10:00", text: "X" }),
    ).rejects.toThrow();
    await expect(
      makeCaller().create({ matterId: "m1", date: "2026-09-11", time: "10", text: "X" }),
    ).rejects.toThrow();
    expect(mockPrisma.serviceNote.create).not.toHaveBeenCalled();
  });

  it("kräver icke-tom text", async () => {
    await expect(
      makeCaller().create({ matterId: "m1", date: "2026-06-15", time: "09:30", text: "" }),
    ).rejects.toThrow();
  });

  it("respekterar explicit authorId och skapad-datum från admin direkt (setup/fixtures)", async () => {
    await makeCaller("org-a", "u-9", "ADMIN").create({
      matterId: "m1", date: "2026-06-15", time: "09:30", text: "X", authorId: "u-fix", createdAt: "2026-06-15T09:30:00.000Z",
    });
    const data = mockPrisma.serviceNote.create.mock.calls[0]![0].data;
    expect(data.authorId).toBe("u-fix");
    expect(data.createdAt).toEqual(new Date("2026-06-15T09:30:00.000Z"));
  });

  /** Behörighet (#1362): ärendet i byrån; anteckning i en kollegas namn är ett setup-fält. */
  it("en kollegas authorId eller ett skapad-datum: jurist nekas, admin i kön nekas (FORBIDDEN)", async () => {
    const base = { matterId: "m1", date: "2026-06-15", time: "09:30", text: "X" };
    await expect(makeCaller("org-a", "u-9").create({ ...base, authorId: "u-fix" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(makeCaller("org-a", "u-9").create({ ...base, createdAt: "2020-01-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(makeCaller("org-a", "u-9", "ADMIN", true).create({ ...base, authorId: "u-fix" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Sitt eget id är detsamma som att utelämna det.
    await makeCaller("org-a", "u-9").create({ ...base, authorId: "u-9" });
    expect(mockPrisma.serviceNote.create).toHaveBeenCalledTimes(1);
  });

  it("ett ärende i en annan byrå → NOT_FOUND, ingen anteckning", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    await expect(makeCaller().create({ matterId: "m-annan", date: "2026-06-15", time: "09:30", text: "X" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.serviceNote.create).not.toHaveBeenCalled();
  });

  it.each([
    ["en dag som inte finns (månad 13)", { date: "2026-13-45" }],
    ["30 februari", { date: "2026-02-30" }],
    ["klockan 25", { time: "25:00" }],
    ["minut 61", { time: "10:61" }],
    ["ett ogiltigt skapad-datum", { createdAt: "igår" }],
  ])("avvisar %s (#1362)", async (_label, over) => {
    await expect(makeCaller("org-a", "u1", "ADMIN").create({ matterId: "m1", date: "2026-06-15", time: "09:30", text: "X", ...over }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(makeCaller().update({ id: "sn1", ...("date" in over || "time" in over ? over : { date: "2026-02-30" }) }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.serviceNote.create).not.toHaveBeenCalled();
    expect(mockPrisma.serviceNote.update).not.toHaveBeenCalled();
  });
});

describe("serviceNote.update (#375)", () => {
  it("ägarkollar via matter.organizationId innan update", async () => {
    await makeCaller("org-a").update({ id: "sn1", text: "Rättad" });
    expect(mockPrisma.serviceNote.findFirst).toHaveBeenCalledWith({
      where: { id: "sn1", matter: { organizationId: "org-a" } },
    });
    expect(mockPrisma.serviceNote.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sn1" }, data: expect.objectContaining({ text: "Rättad" }) }),
    );
  });

  it("kastar NOT_FOUND vid org-mismatch (läcker inte existens)", async () => {
    mockPrisma.serviceNote.findFirst.mockResolvedValue(null);
    await expect(makeCaller("org-x").update({ id: "sn1", text: "X" })).rejects.toThrow();
    expect(mockPrisma.serviceNote.update).not.toHaveBeenCalled();
  });

  it("kräver icke-tom text när text anges", async () => {
    await expect(makeCaller().update({ id: "sn1", text: "" })).rejects.toThrow();
  });
});

describe("serviceNote.delete (#375)", () => {
  it("ägarkollar via matter.organizationId innan delete", async () => {
    await makeCaller("org-a").delete({ id: "sn1" });
    expect(mockPrisma.serviceNote.findFirst).toHaveBeenCalledWith({
      where: { id: "sn1", matter: { organizationId: "org-a" } },
    });
    expect(mockPrisma.serviceNote.delete).toHaveBeenCalledWith({ where: { id: "sn1" } });
  });

  it("kastar NOT_FOUND vid org-mismatch", async () => {
    mockPrisma.serviceNote.findFirst.mockResolvedValue(null);
    await expect(makeCaller("org-x").delete({ id: "sn1" })).rejects.toThrow();
    expect(mockPrisma.serviceNote.delete).not.toHaveBeenCalled();
  });
});
