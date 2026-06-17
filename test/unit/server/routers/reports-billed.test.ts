/**
 * Test för reports.billed — "Fakturerat per advokat och period" (#90).
 * Verifierar attribution (direkt invoiceId + via BillingRun), period-filter
 * och avskrivnings-avdrag mot föregående kalendermånad.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { reportsRouter } from "@/lib/server/routers/reports";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

const mockPrisma = {
  user: { findFirst: vi.fn() },
  invoice: { findMany: vi.fn() },
  billingRun: { findMany: vi.fn() },
  timeEntry: { findMany: vi.fn() },
  writeOff: { findMany: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", name: "Anna" });
  mockPrisma.invoice.findMany.mockResolvedValue([]);
  mockPrisma.billingRun.findMany.mockResolvedValue([]);
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
  mockPrisma.writeOff.findMany.mockResolvedValue([]);
});

const te = (o: Record<string, unknown> = {}) => ({
  userId: "u1", minutes: 60, hourlyRate: 100_000, invoiceId: null, frozenByBillingRunId: null, ...o,
});

describe("reports.billed", () => {
  it("null när användaren inte finns", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    expect(await makeCaller().billed({ ...JUNE, userId: "u1" })).toBeNull();
  });

  it("attribuerar faktura via direkt invoiceId och summerar", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "i1", amount: 100_000, status: "SENT", invoiceDate: new Date("2026-06-15"), updatedAt: new Date("2026-06-15"), matter: { matterNumber: "2026-0001", title: "Tvist" } },
    ]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([te({ invoiceId: "i1" })]);

    const res = await makeCaller().billed({ ...JUNE, userId: "u1" });
    expect(res?.billedOre).toBe(100_000);
    expect(res?.invoices).toHaveLength(1);
    expect(res?.invoices[0]).toMatchObject({ id: "i1", shareOre: 100_000, matterNumber: "2026-0001" });
    expect(res?.netOre).toBe(100_000);
  });

  it("attribuerar faktura via BillingRun (frozenByBillingRunId → invoiceId)", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "i2", amount: 50_000, status: "PAID", invoiceDate: new Date("2026-06-10"), updatedAt: new Date("2026-06-10"), matter: { matterNumber: "2026-0002", title: "X" } },
    ]);
    mockPrisma.billingRun.findMany.mockResolvedValue([{ id: "run1", invoiceId: "i2" }]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([te({ frozenByBillingRunId: "run1" })]);

    const res = await makeCaller().billed({ ...JUNE, userId: "u1" });
    expect(res?.billedOre).toBe(50_000);
    expect(res?.invoices[0]?.id).toBe("i2");
  });

  it("fördelar proportionellt mellan advokater", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "i3", amount: 100_000, status: "SENT", invoiceDate: new Date("2026-06-12"), updatedAt: new Date("2026-06-12"), matter: { matterNumber: "2026-0003", title: "Y" } },
    ]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      te({ invoiceId: "i3", userId: "u1", minutes: 45, hourlyRate: 100_000 }), // 75 000 öre
      te({ invoiceId: "i3", userId: "u2", minutes: 15, hourlyRate: 100_000 }), // 25 000 öre
    ]);
    const res = await makeCaller().billed({ ...JUNE, userId: "u1" });
    expect(res?.billedOre).toBe(75_000); // Annas 75 %
  });

  it("drar av faktura avskriven i föregående kalendermånad (maj)", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "billed", amount: 100_000, status: "SENT", invoiceDate: new Date("2026-06-15"), updatedAt: new Date("2026-06-15"), matter: { matterNumber: "A", title: "A" } },
      { id: "wo", amount: 40_000, status: "BAD_DEBT", invoiceDate: new Date("2026-03-01"), updatedAt: new Date("2026-05-10"), matter: { matterNumber: "B", title: "B" } },
    ]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      te({ invoiceId: "billed" }),
      te({ invoiceId: "wo" }),
    ]);
    const res = await makeCaller().billed({ ...JUNE, userId: "u1" });
    expect(res?.billedOre).toBe(100_000);
    expect(res?.writeOffOre).toBe(40_000);
    expect(res?.netOre).toBe(60_000);
    expect(res?.prevPeriod).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    // Den avskrivna (utfärdad i mars) syns inte i periodens billed-lista.
    expect(res?.invoices.map((i) => i.id)).toEqual(["billed"]);
  });

  it("writtenOffAt tas från WriteOff-posten, inte invoice.updatedAt (ADR 0007)", async () => {
    // updatedAt i juni (utanför maj-perioden) men WriteOff-posten daterad i maj
    // → avdraget ska ske → bevisar att posten styr, inte updatedAt-hacket.
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "wo", amount: 40_000, status: "BAD_DEBT", invoiceDate: new Date("2026-03-01"), updatedAt: new Date("2026-06-20"), matter: { matterNumber: "B", title: "B" } },
    ]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([te({ invoiceId: "wo" })]);
    mockPrisma.writeOff.findMany.mockResolvedValue([
      { invoiceId: "wo", writtenOffAt: new Date("2026-05-10") },
    ]);
    const res = await makeCaller().billed({ ...JUNE, userId: "u1" });
    expect(res?.writeOffOre).toBe(40_000);
  });
});
