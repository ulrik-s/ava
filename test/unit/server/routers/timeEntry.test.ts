/**
 * Test för timeEntryRouter — list/create/update/delete/report.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { timeEntryRouter } from "@/lib/server/routers/timeEntry";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  timeEntry: {
    findMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  user: {
    findUniqueOrThrow: vi.fn(),
  },
};

function makeCaller(orgId = "org-a", userId = "u1") {
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return timeEntryRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
  mockPrisma.timeEntry.count.mockResolvedValue(0);
  mockPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { minutes: 0 } });
});

describe("timeEntry.list", () => {
  it("scopar via matter.organizationId", async () => {
    await makeCaller("org-a").list({});
    expect(mockPrisma.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matter: { organizationId: "org-a" } },
      }),
    );
  });

  it("filtrerar på matterId och userId", async () => {
    await makeCaller().list({ matterId: "m1", userId: "u9" });
    const w = mockPrisma.timeEntry.findMany.mock.calls[0][0].where;
    expect(w.matterId).toBe("m1");
    expect(w.userId).toBe("u9");
  });

  it("filtrerar på datumintervall when from+to anges", async () => {
    const from = new Date("2026-01-01");
    const to = new Date("2026-12-31");
    await makeCaller().list({ from, to });
    const w = mockPrisma.timeEntry.findMany.mock.calls[0][0].where;
    expect(w.date.gte).toBe(from);
    expect(w.date.lte).toBe(to);
  });

  it("returnerar totalMinutes från aggregate", async () => {
    mockPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { minutes: 420 } });
    const res = await makeCaller().list({});
    expect(res.totalMinutes).toBe(420);
  });
});

describe("timeEntry.create", () => {
  it("kopplar userId och hourlyRate från user-record", async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ hourlyRate: 3000 });
    mockPrisma.timeEntry.create.mockResolvedValue({});
    await makeCaller("org-a", "u-9").create({
      matterId: "m1",
      date: "2026-04-15",
      minutes: 90,
      description: "Möte",
    });
    const args = mockPrisma.timeEntry.create.mock.calls[0][0];
    expect(args.data.userId).toBe("u-9");
    expect(args.data.hourlyRate).toBe(3000);
    expect(args.data.minutes).toBe(90);
    expect(args.data.date).toBeInstanceOf(Date);
  });

  it("nollställer hourlyRate om user saknar timtaxa", async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ hourlyRate: null });
    mockPrisma.timeEntry.create.mockResolvedValue({});
    await makeCaller().create({
      matterId: "m1",
      date: "2026-04-15",
      minutes: 30,
      description: "X",
    });
    expect(mockPrisma.timeEntry.create.mock.calls[0][0].data.hourlyRate).toBe(0);
  });

  it("validerar minutes > 0", async () => {
    await expect(
      makeCaller().create({ matterId: "m1", date: "2026-01-01", minutes: 0, description: "X" }),
    ).rejects.toThrow();
  });
});

describe("timeEntry.update", () => {
  it("konverterar date-sträng till Date", async () => {
    mockPrisma.timeEntry.update.mockResolvedValue({});
    await makeCaller().update({ id: "t1", date: "2026-03-15" });
    expect(mockPrisma.timeEntry.update.mock.calls[0][0].data.date).toBeInstanceOf(Date);
  });

  it("uppdaterar bara skickade fält", async () => {
    mockPrisma.timeEntry.update.mockResolvedValue({});
    await makeCaller().update({ id: "t1", description: "Nytt" });
    const data = mockPrisma.timeEntry.update.mock.calls[0][0].data;
    expect(data.description).toBe("Nytt");
    expect(data.minutes).toBeUndefined();
  });
});

describe("timeEntry.delete", () => {
  it("tar bort entry", async () => {
    mockPrisma.timeEntry.delete.mockResolvedValue({});
    await makeCaller().delete({ id: "t1" });
    expect(mockPrisma.timeEntry.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });
});

describe("timeEntry.report", () => {
  it("grupperar entries per användare", async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      {
        id: "1", userId: "u1", minutes: 60, billable: true,
        user: { id: "u1", name: "Anna" },
        matter: { id: "m1", matterNumber: "2026-0001", title: "X", contacts: [] },
      },
      {
        id: "2", userId: "u1", minutes: 30, billable: false,
        user: { id: "u1", name: "Anna" },
        matter: { id: "m1", matterNumber: "2026-0001", title: "X", contacts: [] },
      },
      {
        id: "3", userId: "u2", minutes: 45, billable: true,
        user: { id: "u2", name: "Bob" },
        matter: { id: "m1", matterNumber: "2026-0001", title: "X", contacts: [] },
      },
    ]);

    const res = await makeCaller().report({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(res.totalEntries).toBe(3);
    expect(res.byUser["u1"].name).toBe("Anna");
    expect(res.byUser["u1"].totalMinutes).toBe(90);
    expect(res.byUser["u1"].billableMinutes).toBe(60);
    expect(res.byUser["u2"].totalMinutes).toBe(45);
  });

  it("filtrerar på userIds-array när angiven", async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    await makeCaller().report({
      from: "2026-01-01",
      to: "2026-12-31",
      userIds: ["u1", "u2"],
    });
    const w = mockPrisma.timeEntry.findMany.mock.calls[0][0].where;
    expect(w.userId).toEqual({ in: ["u1", "u2"] });
  });

  it("filtrerar på enskild userId när angiven", async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    await makeCaller().report({
      from: "2026-01-01",
      to: "2026-12-31",
      userId: "u1",
    });
    const w = mockPrisma.timeEntry.findMany.mock.calls[0][0].where;
    expect(w.userId).toBe("u1");
  });

  it("ignorerar userId om userIds finns", async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    await makeCaller().report({
      from: "2026-01-01",
      to: "2026-12-31",
      userId: "u1",
      userIds: ["u2", "u3"],
    });
    const w = mockPrisma.timeEntry.findMany.mock.calls[0][0].where;
    expect(w.userId).toEqual({ in: ["u2", "u3"] });
  });

  it("filtrerar på matterId när angiven", async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    await makeCaller().report({
      from: "2026-01-01",
      to: "2026-12-31",
      matterId: "m1",
    });
    const w = mockPrisma.timeEntry.findMany.mock.calls[0][0].where;
    expect(w.matterId).toBe("m1");
  });
});
