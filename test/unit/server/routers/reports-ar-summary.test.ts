/**
 * Test för reports.arSummary (#27 coverage) — Kundfordrings-sammanställningen
 * (ADR 0007): brygga + åldersanalys + per-faktura-rader, period-scoping, och
 * den valfria advokat-attributionen (proportionellt mot fryst arbetsvärde).
 *
 * Täcker router-proceduren + helprarna arMetaById/arRowsFrom/lawyerShareRatios
 * som de andra reports-testerna (perLawyer/billed) inte rör.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { reportsRouter } from "@/lib/server/routers/reports";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  user: { findFirst: vi.fn() },
  invoice: { findMany: vi.fn() },
  payment: { findMany: vi.fn() },
  writeOff: { findMany: vi.fn() },
  billingRun: { findMany: vi.fn() },
  timeEntry: { findMany: vi.fn() },
};

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "u-self", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma,
    dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
    get repos() { return buildInMemoryRepositories(this.dataStore as unknown as IDataStore); },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return reportsRouter.createCaller(ctx as any);
}

const JUNE = { from: "2026-06-01", to: "2026-06-30" };

const inv = (o: Record<string, unknown> = {}) => ({
  id: "i1", amount: 100_000, status: "SENT", invoiceType: "STANDARD", creditedInvoiceId: null,
  invoiceNumber: "F-2026-0001", invoiceDate: new Date("2026-06-15"), dueDate: new Date("2026-07-15"), dueAt: null,
  matter: { id: "m1", matterNumber: "2026-0001", title: "Tvist" }, ...o,
});
const teFrozen = (o: Record<string, unknown> = {}) => ({
  userId: "u1", minutes: 60, hourlyRate: 100_000, invoiceId: "i1", frozenByBillingRunId: null, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "Anna" });
  mockPrisma.invoice.findMany.mockResolvedValue([]);
  mockPrisma.payment.findMany.mockResolvedValue([]);
  mockPrisma.writeOff.findMany.mockResolvedValue([]);
  mockPrisma.billingRun.findMany.mockResolvedValue([]);
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
});

describe("reports.arSummary — utan advokatfilter", () => {
  it("bygger brygga + per-faktura-rader ur faktura/betalning/avskrivning", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([inv()]);
    mockPrisma.payment.findMany.mockResolvedValue([{ invoiceId: "i1", amount: 30_000 }]);

    const res = await makeCaller().arSummary({ ...JUNE });
    expect(res.bridge.fakturerat).toBe(100_000);
    expect(res.bridge.inbetalt).toBe(30_000);
    expect(res.bridge.utestaende).toBe(70_000);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "i1", invoiceNumber: "F-2026-0001", matterNumber: "2026-0001", title: "Tvist",
      fakturerat: 100_000, inbetalt: 30_000, utestaende: 70_000,
    });
    expect(res.aging).toBeDefined();
  });

  it("avskrivning syns i bryggan som konstaterad kundförlust", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([inv({ status: "BAD_DEBT" })]);
    mockPrisma.writeOff.findMany.mockResolvedValue([{ invoiceId: "i1", amount: 100_000 }]);

    const res = await makeCaller().arSummary({ ...JUNE });
    expect(res.bridge.konstateradKundforlust).toBe(100_000);
    expect(res.rows[0]).toMatchObject({ avskrivet: 100_000 });
  });

  it("scopar bort fakturor utställda utanför perioden", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([inv({ invoiceDate: new Date("2026-03-01") })]);
    const res = await makeCaller().arSummary({ ...JUNE });
    expect(res.rows).toHaveLength(0);
    expect(res.bridge.fakturerat).toBe(0);
  });
});

describe("reports.arSummary — med advokatfilter (attribution)", () => {
  it("hela fakturan attribueras advokaten när all frusen tid är hens (ratio 1.0)", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([inv()]);
    mockPrisma.payment.findMany.mockResolvedValue([{ invoiceId: "i1", amount: 30_000 }]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([teFrozen({ userId: "u1" })]);

    const res = await makeCaller().arSummary({ ...JUNE, userId: "u1" });
    expect(res.bridge.fakturerat).toBe(100_000);
    expect(res.rows[0]).toMatchObject({ fakturerat: 100_000 });
  });

  it("attribuerar via BillingRun (frozenByBillingRunId → invoiceId)", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([inv()]);
    mockPrisma.billingRun.findMany.mockResolvedValue([{ id: "run1", invoiceId: "i1" }]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      teFrozen({ userId: "u1", invoiceId: null, frozenByBillingRunId: "run1" }),
    ]);
    const res = await makeCaller().arSummary({ ...JUNE, userId: "u1" });
    expect(res.bridge.fakturerat).toBe(100_000);
  });

  it("annan advokats arbete (ratio 0) → inget attribueras", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([inv()]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([teFrozen({ userId: "u2" })]);
    const res = await makeCaller().arSummary({ ...JUNE, userId: "u1" });
    expect(res.bridge.fakturerat).toBe(0);
  });

  it("proportionell andel: 75 % av fakturan", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([inv()]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      teFrozen({ userId: "u1", minutes: 45 }), // 75 000 öre
      teFrozen({ userId: "u2", minutes: 15 }), // 25 000 öre
    ]);
    const res = await makeCaller().arSummary({ ...JUNE, userId: "u1" });
    expect(res.bridge.fakturerat).toBe(75_000);
  });
});
