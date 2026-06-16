/**
 * paymentPlanRouter — list (+ sökfilter/planHaystack), getById, cancel,
 * recordReminder och scanDueReminders (#23). Org-scope via planens invoice;
 * NOT_FOUND när planen inte finns/ej i org.
 */

import { TRPCError } from "@trpc/server";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { paymentPlanRouter } from "@/lib/server/routers/paymentPlan";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  paymentPlan: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  paymentPlanReminder: { create: vi.fn() },
  invoice: { update: vi.fn() },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: vi.fn(<T,>(fn: (tx: any) => Promise<T>) => fn(mockPrisma)),
};

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "u1", email: "a@b.com", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma,
    dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return paymentPlanRouter.createCaller(ctx as any);
}

beforeEach(() => vi.clearAllMocks());

describe("paymentPlan.recordReminder", () => {
  it("loggar en påminnelse för en plan i org:en (sentAt → Date)", async () => {
    mockPrisma.paymentPlan.findFirst.mockResolvedValue({ id: "pp-1", invoiceId: "inv-1", status: "ACTIVE" });
    mockPrisma.paymentPlanReminder.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...data }),
    );

    const res = await makeCaller().recordReminder({
      id: "ppr-1", planId: "pp-1", dueMonth: "2026-03", type: "DUE", sentAt: "2026-03-10T00:00:00Z",
    });

    expect(res.planId).toBe("pp-1");
    expect(res.dueMonth).toBe("2026-03");
    const arg = mockPrisma.paymentPlanReminder.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.id).toBe("ppr-1");
    expect(arg.data.type).toBe("DUE");
    expect(arg.data.sentAt).toBeInstanceOf(Date);
  });

  it("defaultar sentAt till now() när det utelämnas", async () => {
    mockPrisma.paymentPlan.findFirst.mockResolvedValue({ id: "pp-1", invoiceId: "inv-1", status: "ACTIVE" });
    mockPrisma.paymentPlanReminder.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...data }),
    );
    await makeCaller().recordReminder({ planId: "pp-1", dueMonth: "2026-04", type: "OVERDUE" });
    const arg = mockPrisma.paymentPlanReminder.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.sentAt).toBeInstanceOf(Date);
  });

  it("kastar NOT_FOUND när planen inte tillhör org:en", async () => {
    mockPrisma.paymentPlan.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().recordReminder({ planId: "saknas", dueMonth: "2026-03", type: "DUE" }),
    ).rejects.toThrow(TRPCError);
    expect(mockPrisma.paymentPlanReminder.create).not.toHaveBeenCalled();
  });
});

// En joinad plan-rad som list/scan returnerar.
const joinedPlan = (o: Record<string, unknown> = {}) => ({
  id: "pp-1", status: "ACTIVE", monthlyAmount: 100_000, dayOfMonth: 15, startDate: "2026-06-01",
  notes: null,
  invoice: {
    amount: 1_000_000, payments: [{ amount: 0 }],
    matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist Lindström",
      contacts: [{ contact: { name: "Anna Andersson", email: "anna@x.se" } }] },
  },
  reminders: [],
  ...o,
});

describe("paymentPlan.list", () => {
  it("returnerar alla planer i org:en utan sökterm", async () => {
    mockPrisma.paymentPlan.findMany.mockResolvedValue([joinedPlan(), joinedPlan({ id: "pp-2" })]);
    const res = await makeCaller().list({});
    expect(res).toHaveLength(2);
    expect(mockPrisma.paymentPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ invoice: { matter: { organizationId: "org-a" } } }) }),
    );
  });

  it("filtrerar på status när angivet", async () => {
    mockPrisma.paymentPlan.findMany.mockResolvedValue([]);
    await makeCaller().list({ status: "COMPLETED" });
    expect(mockPrisma.paymentPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "COMPLETED" }) }),
    );
  });

  it("söker i ärendenr/titel/klient/anteckningar (planHaystack)", async () => {
    mockPrisma.paymentPlan.findMany.mockResolvedValue([
      joinedPlan({ id: "match" }),
      joinedPlan({ id: "miss", invoice: { matter: { matterNumber: "2026-9999", title: "Annat", contacts: [] } } }),
    ]);
    const res = await makeCaller().list({ search: "lindström" });
    expect(res.map((p: { id: string }) => p.id)).toEqual(["match"]);
  });

  it("matchar på klientnamn", async () => {
    mockPrisma.paymentPlan.findMany.mockResolvedValue([joinedPlan()]);
    const res = await makeCaller().list({ search: "andersson" });
    expect(res).toHaveLength(1);
  });
});

describe("paymentPlan.getById", () => {
  it("returnerar planen när den finns i org:en", async () => {
    const plan = joinedPlan();
    mockPrisma.paymentPlan.findFirst.mockResolvedValue(plan);
    expect(await makeCaller().getById({ id: "pp-1" })).toBe(plan);
  });

  it("NOT_FOUND när planen saknas/ej i org", async () => {
    mockPrisma.paymentPlan.findFirst.mockResolvedValue(null);
    await expect(makeCaller().getById({ id: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("paymentPlan.cancel", () => {
  it("avbryter en aktiv plan → CANCELLED + invoice tillbaka SENT", async () => {
    mockPrisma.paymentPlan.findFirst.mockResolvedValue({ id: "pp-1", status: "ACTIVE", invoiceId: "inv-1" });
    const res = await makeCaller().cancel({ planId: "pp-1" });
    expect(res).toEqual({ ok: true });
    expect(mockPrisma.paymentPlan.update).toHaveBeenCalledWith({ where: { id: "pp-1" }, data: { status: "CANCELLED" } });
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { status: "SENT" } });
  });

  it("NOT_FOUND när planen inte tillhör org:en", async () => {
    mockPrisma.paymentPlan.findFirst.mockResolvedValue(null);
    await expect(makeCaller("org-b").cancel({ planId: "pp-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.paymentPlan.update).not.toHaveBeenCalled();
  });

  it("BAD_REQUEST när planen inte är ACTIVE", async () => {
    mockPrisma.paymentPlan.findFirst.mockResolvedValue({ id: "pp-1", status: "CANCELLED", invoiceId: "inv-1" });
    await expect(makeCaller().cancel({ planId: "pp-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.paymentPlan.update).not.toHaveBeenCalled();
  });
});

describe("paymentPlan.scanDueReminders (#23)", () => {
  beforeEach(() => {
    mockPrisma.paymentPlanReminder.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...data }),
    );
  });

  it("genererar en DUE-påminnelse när förfallodagen passerat innevarande månad", async () => {
    // startDate samma månad som asOf → ingen OVERDUE; asOf-datum 20 ≥ dayOfMonth 15 → DUE.
    mockPrisma.paymentPlan.findMany.mockResolvedValue([joinedPlan({ startDate: "2026-06-01" })]);
    const res = await makeCaller().scanDueReminders({ asOf: "2026-06-20T00:00:00.000Z" });
    expect(res.scanned).toBe(1);
    expect(res.due).toBe(1);
    expect(res.overdue).toBe(0);
    expect(mockPrisma.paymentPlanReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ planId: "pp-1", dueMonth: "2026-06", type: "DUE" }) }),
    );
  });

  it("genererar en OVERDUE-påminnelse för föregående månad", async () => {
    // startDate i maj, asOf i juni → föregående månad (maj) obetald → OVERDUE.
    mockPrisma.paymentPlan.findMany.mockResolvedValue([joinedPlan({ startDate: "2026-05-01" })]);
    const res = await makeCaller().scanDueReminders({ asOf: "2026-06-20T00:00:00.000Z" });
    expect(res.overdue).toBe(1);
    expect(mockPrisma.paymentPlanReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "OVERDUE", dueMonth: "2026-05" }) }),
    );
  });

  it("hoppar över redan loggade påminnelser (idempotent)", async () => {
    mockPrisma.paymentPlan.findMany.mockResolvedValue([
      joinedPlan({ startDate: "2026-06-01", reminders: [{ dueMonth: "2026-06", type: "DUE" }] }),
    ]);
    const res = await makeCaller().scanDueReminders({ asOf: "2026-06-20T00:00:00.000Z" });
    expect(res.due).toBe(0);
    expect(mockPrisma.paymentPlanReminder.create).not.toHaveBeenCalled();
  });

  it("tom org → scanned 0, inga påminnelser", async () => {
    mockPrisma.paymentPlan.findMany.mockResolvedValue([]);
    const res = await makeCaller().scanDueReminders();
    expect(res).toMatchObject({ scanned: 0, planned: 0, due: 0, overdue: 0 });
  });
});
