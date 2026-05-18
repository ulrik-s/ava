import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { documentRouter } from "@/server/routers/document";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

// ─── Helpers ─────────────────────────────────────────────────────

const mockPrisma = {
  matterEventSuggestion: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "user-1", email: "a@b.com", name: "Test", role: "ADMIN", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return documentRouter.createCaller(ctx as any);
}

const EVENT_PENDING = {
  id: "ev-1",
  documentId: "doc-1",
  title: "Huvudförhandling",
  description: null,
  eventType: "Förhandling",
  startAt: new Date("2026-05-14T09:00:00Z"),
  endAt: null,
  allDay: false,
  location: "Stockholms tingsrätt",
  status: "PENDING",
  createdAt: new Date(),
  updatedAt: new Date(),
  document: { id: "doc-1", fileName: "stamning.pdf", title: "Stämningsansökan" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── events (list) ───────────────────────────────────────────────

describe("document.events — lista tidpunkter för ärende", () => {
  it("returnerar ej avvisade events för ärende, sorterade på startAt", async () => {
    mockPrisma.matterEventSuggestion.findMany.mockResolvedValue([EVENT_PENDING]);

    const result = await makeCaller("org-a").events({ matterId: "mat-1" });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Huvudförhandling");
    expect(mockPrisma.matterEventSuggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: "REJECTED" },
          document: expect.objectContaining({
            matterId: "mat-1",
            matter: { organizationId: "org-a" },
          }),
        }),
        orderBy: { startAt: "asc" },
      })
    );
  });

  it("filtrerar på anropande användares organisation", async () => {
    mockPrisma.matterEventSuggestion.findMany.mockResolvedValue([]);

    await makeCaller("org-b").events({ matterId: "mat-1" });

    expect(mockPrisma.matterEventSuggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          document: expect.objectContaining({
            matter: { organizationId: "org-b" },
          }),
        }),
      })
    );
  });

  it("inkluderar dokumentmetadata för visning", async () => {
    mockPrisma.matterEventSuggestion.findMany.mockResolvedValue([]);

    await makeCaller("org-a").events({ matterId: "mat-1" });

    expect(mockPrisma.matterEventSuggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { document: { select: { id: true, fileName: true, title: true } } },
      })
    );
  });
});

// ─── rejectEvent ─────────────────────────────────────────────────

describe("document.rejectEvent", () => {
  it("markerar event som REJECTED", async () => {
    mockPrisma.matterEventSuggestion.findFirst.mockResolvedValue(EVENT_PENDING);
    mockPrisma.matterEventSuggestion.update.mockResolvedValue({
      ...EVENT_PENDING,
      status: "REJECTED",
    });

    const result = await makeCaller("org-a").rejectEvent({ eventId: "ev-1" });

    expect(result.status).toBe("REJECTED");
    expect(mockPrisma.matterEventSuggestion.update).toHaveBeenCalledWith({
      where: { id: "ev-1" },
      data: { status: "REJECTED" },
    });
  });

  it("verifierar att eventet tillhör anropande org innan update", async () => {
    mockPrisma.matterEventSuggestion.findFirst.mockResolvedValue(EVENT_PENDING);
    mockPrisma.matterEventSuggestion.update.mockResolvedValue(EVENT_PENDING);

    await makeCaller("org-a").rejectEvent({ eventId: "ev-1" });

    expect(mockPrisma.matterEventSuggestion.findFirst).toHaveBeenCalledWith({
      where: {
        id: "ev-1",
        document: { matter: { organizationId: "org-a" } },
      },
    });
  });

  it("kastar NOT_FOUND om event inte finns eller tillhör annan org", async () => {
    mockPrisma.matterEventSuggestion.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-a").rejectEvent({ eventId: "ev-ghost" })
    ).rejects.toBeInstanceOf(TRPCError);
    await expect(
      makeCaller("org-a").rejectEvent({ eventId: "ev-ghost" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.matterEventSuggestion.update).not.toHaveBeenCalled();
  });
});

// ─── markEventAdded ──────────────────────────────────────────────

describe("document.markEventAdded", () => {
  it("markerar event som ACCEPTED (tillagd i kalender)", async () => {
    mockPrisma.matterEventSuggestion.findFirst.mockResolvedValue(EVENT_PENDING);
    mockPrisma.matterEventSuggestion.update.mockResolvedValue({
      ...EVENT_PENDING,
      status: "ACCEPTED",
    });

    const result = await makeCaller("org-a").markEventAdded({ eventId: "ev-1" });

    expect(result.status).toBe("ACCEPTED");
    expect(mockPrisma.matterEventSuggestion.update).toHaveBeenCalledWith({
      where: { id: "ev-1" },
      data: { status: "ACCEPTED" },
    });
  });

  it("kastar NOT_FOUND för okänt event", async () => {
    mockPrisma.matterEventSuggestion.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-a").markEventAdded({ eventId: "ev-ghost" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.matterEventSuggestion.update).not.toHaveBeenCalled();
  });

  it("org-isolation: event i annan org kan inte markeras", async () => {
    // findFirst returnerar null eftersom where-villkoret inte matchar annan org
    mockPrisma.matterEventSuggestion.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-b").markEventAdded({ eventId: "ev-1" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.matterEventSuggestion.findFirst).toHaveBeenCalledWith({
      where: {
        id: "ev-1",
        document: { matter: { organizationId: "org-b" } },
      },
    });
  });
});
