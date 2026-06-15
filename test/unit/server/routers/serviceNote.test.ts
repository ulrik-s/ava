/**
 * Test för serviceNoteRouter (#348) — append-only list + create.
 * list org-scopas via matter.organizationId; create sätter authorId + org
 * från context.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { serviceNoteRouter } from "@/lib/server/routers/serviceNote";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  serviceNote: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
};

function makeCaller(orgId = "org-a", userId = "u1") {
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return serviceNoteRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.serviceNote.findMany.mockResolvedValue([]);
  mockPrisma.serviceNote.create.mockResolvedValue({ id: "sn1" });
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

  it("kräver icke-tom text", async () => {
    await expect(
      makeCaller().create({ matterId: "m1", date: "2026-06-15", time: "09:30", text: "" }),
    ).rejects.toThrow();
  });

  it("respekterar explicit authorId (setup/fixtures)", async () => {
    await makeCaller("org-a", "u-9").create({
      matterId: "m1", date: "2026-06-15", time: "09:30", text: "X", authorId: "u-fix",
    });
    expect(mockPrisma.serviceNote.create.mock.calls[0]![0].data.authorId).toBe("u-fix");
  });
});
