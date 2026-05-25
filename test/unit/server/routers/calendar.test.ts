/**
 * Tester för calendarRouter — list/get/create/update/delete CalendarEvent.
 *
 * Fokus:
 *   - Ownership-guard (user kan bara se/ändra egna events)
 *   - mirror-status-hantering (pending när mirrorToOutlook flippas)
 *   - Tidsfönsterfiltrering i list
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { calendarRouter } from "@/server/routers/calendar";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  calendarEvent: {
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

function makeCaller(userId = "u1", orgId = "org-a") {
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return calendarRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.calendarEvent.findMany.mockResolvedValue([]);
});

describe("calendar.list", () => {
  it("scopar till aktiv användare + organisation", async () => {
    await makeCaller("u-anna", "org-x").list();
    expect(mockPrisma.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u-anna", organizationId: "org-x" },
      }),
    );
  });

  it("filtrerar på tidsfönster i minne (in-memory query-engine saknar range)", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      { id: "e1", startAt: new Date("2026-05-20T10:00:00Z") },
      { id: "e2", startAt: new Date("2026-05-24T10:00:00Z") },
      { id: "e3", startAt: new Date("2026-05-30T10:00:00Z") },
    ]);
    const events = await makeCaller().list({
      from: new Date("2026-05-23T00:00:00Z"),
      to: new Date("2026-05-25T23:59:59Z"),
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { id: string }).id).toBe("e2");
  });

  it("returnerar alla utan tidsfilter", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      { id: "e1", startAt: new Date() },
      { id: "e2", startAt: new Date() },
    ]);
    const events = await makeCaller().list();
    expect(events).toHaveLength(2);
  });
});

describe("calendar.listForUsers", () => {
  it("scopar till organisation + tillåtna userIds", async () => {
    await makeCaller("u-anna", "org-x").listForUsers({ userIds: ["u-anna", "u-bjorn"] });
    expect(mockPrisma.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-x",
          userId: { in: ["u-anna", "u-bjorn"] },
        },
      }),
    );
  });

  it("filtrerar bort private-events från ANDRA användare men behåller egna", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      { id: "e1", userId: "u-anna", visibility: "normal", startAt: new Date() },
      { id: "e2", userId: "u-bjorn", visibility: "private", startAt: new Date() },
      { id: "e3", userId: "u-anna", visibility: "private", startAt: new Date() },
      { id: "e4", userId: "u-bjorn", visibility: "normal", startAt: new Date() },
    ]);
    const events = await makeCaller("u-anna").listForUsers({ userIds: ["u-anna", "u-bjorn"] });
    const ids = events.map((e: { id: string }) => e.id);
    expect(ids).toContain("e1");      // egen normal
    expect(ids).toContain("e3");      // egen private OK
    expect(ids).toContain("e4");      // annans normal OK
    expect(ids).not.toContain("e2");  // annans private MÅSTE filtreras
  });

  it("tom userIds-lista → tom array (ingen query mot DB krävs)", async () => {
    const events = await makeCaller().listForUsers({ userIds: [] });
    expect(events).toEqual([]);
  });

  it("range-filter funkar precis som calendar.list (in-memory)", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      { id: "x1", userId: "u-anna", visibility: "normal", startAt: new Date("2026-05-20T10:00:00Z") },
      { id: "x2", userId: "u-anna", visibility: "normal", startAt: new Date("2026-05-24T10:00:00Z") },
      { id: "x3", userId: "u-anna", visibility: "normal", startAt: new Date("2026-05-30T10:00:00Z") },
    ]);
    const events = await makeCaller().listForUsers({
      userIds: ["u-anna"],
      from: new Date("2026-05-23T00:00:00Z"),
      to: new Date("2026-05-25T23:59:59Z"),
    });
    expect(events.map((e: { id: string }) => e.id)).toEqual(["x2"]);
  });
});

describe("calendar.create", () => {
  it("sätter userId + organizationId från ctx + mirrorStatus när mirrorToOutlook=true", async () => {
    mockPrisma.calendarEvent.create.mockResolvedValue({ id: "new-1" });
    await makeCaller("u-anna", "org-x").create({
      title: "Förhandling",
      startAt: new Date("2026-06-01T10:00:00Z"),
      mirrorToOutlook: true,
    });
    expect(mockPrisma.calendarEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Förhandling",
          userId: "u-anna",
          organizationId: "org-x",
          mirrorToOutlook: true,
          mirrorStatus: "pending",
        }),
      }),
    );
  });

  it("sätter mirrorStatus=null när mirrorToOutlook=false", async () => {
    mockPrisma.calendarEvent.create.mockResolvedValue({ id: "new-1" });
    await makeCaller().create({
      title: "Privat möte",
      startAt: new Date(),
    });
    const arg = mockPrisma.calendarEvent.create.mock.calls[0][0] as { data: { mirrorStatus: string | null } };
    expect(arg.data.mirrorStatus).toBeNull();
  });

  it("kräver title min(1) — Zod-validering", async () => {
    await expect(makeCaller().create({
      title: "",
      startAt: new Date(),
    })).rejects.toThrow();
  });

  it("default kind=appointment + allDay=false + visibility=normal", async () => {
    mockPrisma.calendarEvent.create.mockResolvedValue({ id: "x" });
    await makeCaller().create({ title: "Möte", startAt: new Date() });
    const arg = mockPrisma.calendarEvent.create.mock.calls[0][0] as { data: { kind: string; allDay: boolean; visibility: string } };
    expect(arg.data.kind).toBe("appointment");
    expect(arg.data.allDay).toBe(false);
    expect(arg.data.visibility).toBe("normal");
  });
});

describe("calendar.update", () => {
  it("guardar ownership innan update", async () => {
    mockPrisma.calendarEvent.findFirstOrThrow.mockRejectedValue(new Error("Not found"));
    await expect(makeCaller().update({
      id: "e1",
      title: "Försöker ändra andras",
    })).rejects.toThrow("Not found");
    expect(mockPrisma.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("flippa till mirrorToOutlook=true → sätt mirrorStatus=pending", async () => {
    mockPrisma.calendarEvent.findFirstOrThrow.mockResolvedValue({
      id: "e1", mirrorToOutlook: false, mirrorStatus: null,
    });
    mockPrisma.calendarEvent.update.mockResolvedValue({});
    await makeCaller().update({ id: "e1", mirrorToOutlook: true });
    const arg = mockPrisma.calendarEvent.update.mock.calls[0][0] as { data: { mirrorStatus: string } };
    expect(arg.data.mirrorStatus).toBe("pending");
  });

  it("flippa till mirrorToOutlook=false → nollställ outlookEventId + status", async () => {
    mockPrisma.calendarEvent.findFirstOrThrow.mockResolvedValue({
      id: "e1", mirrorToOutlook: true, mirrorStatus: "synced", outlookEventId: "ou-1",
    });
    mockPrisma.calendarEvent.update.mockResolvedValue({});
    await makeCaller().update({ id: "e1", mirrorToOutlook: false });
    const arg = mockPrisma.calendarEvent.update.mock.calls[0][0] as { data: { mirrorStatus: string | null; outlookEventId: string | null } };
    expect(arg.data.mirrorStatus).toBeNull();
    expect(arg.data.outlookEventId).toBeNull();
  });

  it("ändra title på mirrored event → mirrorStatus=pending (re-push)", async () => {
    mockPrisma.calendarEvent.findFirstOrThrow.mockResolvedValue({
      id: "e1", mirrorToOutlook: true, mirrorStatus: "synced",
    });
    mockPrisma.calendarEvent.update.mockResolvedValue({});
    await makeCaller().update({ id: "e1", title: "Nytt namn" });
    const arg = mockPrisma.calendarEvent.update.mock.calls[0][0] as { data: { mirrorStatus: string } };
    expect(arg.data.mirrorStatus).toBe("pending");
  });
});

describe("calendar.delete", () => {
  it("guardar ownership innan delete", async () => {
    mockPrisma.calendarEvent.findFirstOrThrow.mockRejectedValue(new Error("Not found"));
    await expect(makeCaller().delete({ id: "e1" })).rejects.toThrow("Not found");
    expect(mockPrisma.calendarEvent.delete).not.toHaveBeenCalled();
  });

  it("delete forwardar till dataStore", async () => {
    mockPrisma.calendarEvent.findFirstOrThrow.mockResolvedValue({ id: "e1" });
    mockPrisma.calendarEvent.delete.mockResolvedValue({});
    await makeCaller().delete({ id: "e1" });
    expect(mockPrisma.calendarEvent.delete).toHaveBeenCalledWith({ where: { id: "e1" } });
  });
});
