/**
 * paymentPlanRouter — recordReminder (logga utskickad påminnelse).
 * Org-scope via planens invoice; NOT_FOUND när planen inte finns/ej i org.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { paymentPlanRouter } from "@/lib/server/routers/paymentPlan";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  paymentPlan: { findFirst: vi.fn() },
  paymentPlanReminder: { create: vi.fn() },
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
    const arg = mockPrisma.paymentPlanReminder.create.mock.calls[0][0] as { data: Record<string, unknown> };
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
    const arg = mockPrisma.paymentPlanReminder.create.mock.calls[0][0] as { data: Record<string, unknown> };
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
