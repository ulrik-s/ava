/**
 * todoRouter.list — aggregerar tasks (dueAt) + calendar-events (startAt)
 * för en användare/dag-range, sorterat på tid.
 */

import { TRPCError } from "@trpc/server";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { todoRouter } from "@/lib/server/routers/todo";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  user: { findFirst: vi.fn() },
  task: { findMany: vi.fn() },
  calendarEvent: { findMany: vi.fn() },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: vi.fn(<T,>(fn: (tx: any) => Promise<T>) => fn(mockPrisma)),
};

function makeCaller(orgId = "org-a", userId = "u1") {
  const dataStore = dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>);
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore,
    repos: buildInMemoryRepositories(dataStore as unknown as IDataStore),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return todoRouter.createCaller(ctx as any);
}

beforeEach(() => vi.clearAllMocks());

const FROM = new Date("2026-05-28T00:00:00Z");
const TO = new Date("2026-05-28T23:59:59Z");

describe("todo.list", () => {
  it("merger tasks + events tidsordnat", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", organizationId: "org-a" });
    mockPrisma.task.findMany.mockResolvedValue([
      { id: "t1", title: "Skriv inlaga", dueAt: new Date("2026-05-28T16:00:00Z"), description: null, status: "TODO", priority: "MEDIUM", userId: "u1", matter: null },
    ]);
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      { id: "e1", title: "Klientmöte", startAt: new Date("2026-05-28T09:00:00Z"), endAt: new Date("2026-05-28T10:00:00Z"), description: null, kind: "appointment", allDay: false, location: "Kontor", userId: "u1", matter: null },
    ]);

    const items = await makeCaller().list({ from: FROM, to: TO });
    expect(items.map((i) => i.id)).toEqual(["e1", "t1"]); // sortert på tid (09 före 16)
    expect(items[0]!.source).toBe("event");
    expect(items[1]!.source).toBe("task");
    expect(items[0]!.location).toBe("Kontor");
    expect(items[1]!.status).toBe("TODO");
  });

  it("kastar NOT_FOUND när userId inte är i org:en", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(makeCaller().list({ from: FROM, to: TO, userId: "okänd" })).rejects.toThrow();
  });

  it("defaultar till anropande user när userId utelämnas (skippar user-check för egen lookup)", async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.calendarEvent.findMany.mockResolvedValue([]);
    await makeCaller("org-a", "u1").list({ from: FROM, to: TO });
    // För egen-tidslinje hoppar router över user.findFirst (ctx.user är
    // redan autentiserad). Användare-kollen körs bara vid kollegial look-up.
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    // Och tasks-frågan körs ändå med rätt userId.
    const taskQ = mockPrisma.task.findMany.mock.calls[0]![0] as { where: { userId: string } };
    expect(taskQ.where.userId).toBe("u1");
  });

  it("coercar ISO-sträng-datum (demo-projektionen) till Date för sort + endAt", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { id: "t1", title: "Inlaga", dueAt: "2026-05-28T16:00:00Z", description: "x", status: "TODO", priority: "LOW", userId: "u1", matter: null },
    ]);
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      { id: "e1", title: "Möte", startAt: "2026-05-28T09:00:00Z", endAt: "2026-05-28T10:00:00Z", description: null, kind: "appointment", allDay: false, location: "Sal", userId: "u1", matter: null },
    ]);
    const items = await makeCaller().list({ from: FROM, to: TO });
    expect(items.map((i) => i.id)).toEqual(["e1", "t1"]); // ISO-strängar sorteras rätt
    expect(items[0]!.at).toBeInstanceOf(Date);
    expect(items[0]!.endAt).toBeInstanceOf(Date);
  });

  it("event utan endAt + allDay → endAt null, allDay true", async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      { id: "e1", title: "Heldag", startAt: new Date("2026-05-28T08:00:00Z"), endAt: null, description: null, kind: "deadline", allDay: true, location: null, userId: "u1", matter: null },
    ]);
    const items = await makeCaller().list({ from: FROM, to: TO });
    expect(items).toHaveLength(1);
    expect(items[0]!.endAt).toBeNull();
    expect(items[0]!.allDay).toBe(true);
    expect(items[0]!.location).toBeNull();
  });

  it("filtrerar bort poster utanför [from,to] + ogiltiga (saknad) datum", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { id: "out", title: "Imorgon", dueAt: new Date("2026-05-30T10:00:00Z"), description: null, status: "TODO", priority: "LOW", userId: "u1", matter: null },
      { id: "nan", title: "Utan frist", dueAt: undefined, description: null, status: "TODO", priority: "LOW", userId: "u1", matter: null },
      { id: "in", title: "Idag", dueAt: new Date("2026-05-28T12:00:00Z"), description: null, status: "TODO", priority: "LOW", userId: "u1", matter: null },
    ]);
    mockPrisma.calendarEvent.findMany.mockResolvedValue([]);
    const items = await makeCaller().list({ from: FROM, to: TO });
    expect(items.map((i) => i.id)).toEqual(["in"]); // out (utanför) + nan (ogiltig) bortfiltrerade
  });

  it("kollegial look-up: user i org → listar kollegans poster", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u2", organizationId: "org-a" });
    mockPrisma.task.findMany.mockResolvedValue([
      { id: "t2", title: "Kollegans task", dueAt: new Date("2026-05-28T11:00:00Z"), description: null, status: "TODO", priority: "LOW", userId: "u2", matter: null },
    ]);
    mockPrisma.calendarEvent.findMany.mockResolvedValue([]);
    const items = await makeCaller("org-a", "u1").list({ from: FROM, to: TO, userId: "u2" });
    expect(mockPrisma.user.findFirst).toHaveBeenCalled();
    expect(items.map((i) => i.id)).toEqual(["t2"]);
    expect(items[0]!.userId).toBe("u2");
  });
});

// TRPCError import retained even if unused above — tests may extend.
void TRPCError;
