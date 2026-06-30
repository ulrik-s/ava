/**
 * Integrationstest för invoiceRouter.
 *
 * Mockar prisma-klienten (inkl. $transaction) och kör routerprocedurer via
 * createCaller. Täcker:
 *   - createAcconto: create + cross-org-isolation
 *   - createFinal: brutto-räkning, avdragskoppling, validering av ägande +
 *     redan-fakturerade poster + redan-avdragna accontos + negativt netto
 *   - recordPayment: partiell (förblir SENT) vs full (→ PAID + plan COMPLETED)
 *   - createPaymentPlan: status-byte + dubbel-plan-skydd + kräver SENT
 *   - cancelPaymentPlan: återställer status
 *   - setStatus: manuella statusövergångar
 *   - list/getById: org-scoping
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { invoiceRouter } from "@/lib/server/routers/invoice";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

// ─── Mock prisma ─────────────────────────────────────────────────

const mockPrisma = {
  invoice: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  matter: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  timeEntry: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  expense: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  invoiceAccontoDeduction: {
    create: vi.fn(),
  },
  billingRun: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  payment: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  writeOff: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  paymentPlan: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  // $transaction(fn) kör callbacken direkt mot samma mock.
  $transaction: vi.fn(<T,>(fn: (tx: typeof mockPrisma) => Promise<T>) => fn(mockPrisma)),
};

function makeCaller(orgId = "org-a", userId = "user-1") {
  const dataStore = dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>);
  const ctx = {
    user: { id: userId, email: "a@b.com", name: "Test", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore,
    // ADR 0020: markFortnoxBooked är migrerad till ctx.repos → wira in-memory-repos.
    repos: buildInMemoryRepositories(dataStore as unknown as IDataStore),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return invoiceRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Återställ $transaction-implementationen efter clearAllMocks.
  mockPrisma.$transaction.mockImplementation(
    <T,>(fn: (tx: typeof mockPrisma) => Promise<T>) => fn(mockPrisma),
  );
  // Säkra defaults så gatherInvoiceLedger (krediterings-/writeOff-frågor i
  // recordPayment/writeOff) inte ärver en annan tests mockResolvedValue
  // (clearAllMocks rensar call-data men inte implementationer).
  mockPrisma.invoice.findMany.mockResolvedValue([]);
  mockPrisma.writeOff.findMany.mockResolvedValue([]);
  // Repository-sömmens ledger läser betalt-hinken via payments.sumByInvoice.
  mockPrisma.payment.findMany.mockResolvedValue([]);
  // paymentPlans.getByInvoiceId default: ingen plan (clearAllMocks nollar inte
  // mockResolvedValue → annars läcker en annan tests plan hit).
  mockPrisma.paymentPlan.findFirst.mockResolvedValue(null);
});


// ─── createRadgivning (#383, rättshjälp) ─────────────────────────

describe("invoice.createRadgivning", () => {
  beforeEach(() => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null); // nextInvoiceNumber → seq 1
    mockPrisma.invoice.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: "rad-1", ...a.data }));
    mockPrisma.billingRun.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: "run-1", ...a.data }));
    mockPrisma.matter.update.mockResolvedValue({});
  });

  it("skapar ett ACCONTO (DRAFT) + billing-run för rådgivningstimmen + märker ärendet (#851)", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: "m1", organizationId: "org-a", radgivningBetaldAt: null });

    const res = await makeCaller().createRadgivning({ matterId: "m1" });

    // 1 tim × timkostnadsnorm (F-skatt default) = 162 600 netto; brutto = 203 250 (inkl 25 %).
    expect(res.beloppExclVatOre).toBe(162_600);
    const data = mockPrisma.invoice.create.mock.calls[0]![0].data;
    expect(data.invoiceType).toBe("ACCONTO");
    expect(data.amount).toBe(203_250); // brutto (inkl moms) — som ett aconto
    expect(data.status).toBe("DRAFT"); // DRAFT → dras ALDRIG av (additivt)
    // Billing-run så det syns i ärendets faktura-lista.
    const run = mockPrisma.billingRun.create.mock.calls[0]![0].data;
    expect(run.type).toBe("ACCONTO");
    expect(run.recipient).toBe("KLIENT");
    expect(run.status).toBe("DRAFT");
    // Ärendet märks som registrerat.
    expect(mockPrisma.matter.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1" }, data: expect.objectContaining({ radgivningBetaldAt: expect.any(Date) }) }),
    );
  });

  it("är idempotent — avvisar om redan registrerad", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: "m1", organizationId: "org-a", radgivningBetaldAt: new Date() });

    await expect(makeCaller().createRadgivning({ matterId: "m1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
  });

  it("NOT_FOUND cross-org", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    await expect(makeCaller("org-b").createRadgivning({ matterId: "m1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── recordPayment ───────────────────────────────────────────────

describe("invoice.recordPayment", () => {
  it("partiell betalning: skapar Payment men låter status vara", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      amount: 1_000_000,
      status: "SENT",
      paymentPlan: null,
    });
    mockPrisma.payment.findMany.mockResolvedValue([{ amount: 200_000 }]); // betalt före
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-1", amount: 300_000 });

    const res = await makeCaller().recordPayment({
      invoiceId: "inv-1",
      amount: 300_000,
      paidAt: "2026-05-15",
    });

    expect(res.paidSum).toBe(500_000);
    expect(res.settled).toBe(false);
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("full betalning: markerar invoice PAID (ingen plan)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      amount: 1_000_000,
      status: "SENT",
      paymentPlan: null,
    });
    mockPrisma.payment.findMany.mockResolvedValue([{ amount: 900_000 }]); // betalt före
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-2", amount: 100_000 });

    const res = await makeCaller().recordPayment({
      invoiceId: "inv-1",
      amount: 100_000,
      paidAt: "2026-05-15",
    });

    expect(res.settled).toBe(true);
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" }, data: expect.objectContaining({ status: "PAID" }) }),
    );
    expect(mockPrisma.paymentPlan.update).not.toHaveBeenCalled();
  });

  it("full betalning på faktura med plan: PAID + plan COMPLETED", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      amount: 1_000_000,
      status: "INSTALLMENT_PLAN",
    });
    mockPrisma.payment.findMany.mockResolvedValue([{ amount: 999_999 }]); // betalt före
    mockPrisma.paymentPlan.findFirst.mockResolvedValue({ id: "plan-1", invoiceId: "inv-1" });
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-last", amount: 1 });

    await makeCaller().recordPayment({
      invoiceId: "inv-1",
      amount: 1,
      paidAt: "2026-05-15",
    });

    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" }, data: expect.objectContaining({ status: "PAID" }) }),
    );
    expect(mockPrisma.paymentPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "plan-1" }, data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
  });

  it("NOT_FOUND när fakturan tillhör annan org", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-b").recordPayment({
        invoiceId: "inv-1",
        amount: 100,
        paidAt: "2026-05-15",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it("auto-skickar en DRAFT vid första betalningen (#350: PAID passerar SENT)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", amount: 1_000_000, status: "DRAFT", paymentPlan: null, payments: [],
    });
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-1", amount: 300_000 });

    const res = await makeCaller().recordPayment({ invoiceId: "inv-1", amount: 300_000, paidAt: "2026-05-15" });

    // Betalningen registreras OCH fakturan auto-sätts SENT (inte kvar som DRAFT).
    expect(mockPrisma.payment.create).toHaveBeenCalled();
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" }, data: expect.objectContaining({ status: "SENT" }) }),
    );
    expect(res.settled).toBe(false); // delbetalning → stannar SENT
  });

  it("vägrar betalning på CANCELLED-faktura (#350)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", amount: 1_000_000, status: "CANCELLED", paymentPlan: null, payments: [],
    });

    await expect(
      makeCaller().recordPayment({ invoiceId: "inv-1", amount: 100_000, paidAt: "2026-05-15" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it("avvisar översummerande betalning (partition-invariant, ADR 0007)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", amount: 1_000_000, status: "SENT", paymentPlan: null,
    });
    mockPrisma.payment.findMany.mockResolvedValue([{ amount: 900_000 }]); // betalt före
    mockPrisma.invoice.findMany.mockResolvedValue([]); // inga krediteringar
    mockPrisma.writeOff.findMany.mockResolvedValue([]); // inget avskrivet

    // utestående = 100 000; försök betala 200 000 → utestående < 0
    await expect(makeCaller().recordPayment({ invoiceId: "inv-1", amount: 200_000, paidAt: "2026-05-15" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });
});

// ─── createPaymentPlan ───────────────────────────────────────────

describe("invoice.createPaymentPlan", () => {
  it("skapar plan och sätter invoice.status=INSTALLMENT_PLAN", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      status: "SENT",
      paymentPlan: null,
    });
    mockPrisma.paymentPlan.create.mockResolvedValue({ id: "plan-1" });

    await makeCaller().createPaymentPlan({
      invoiceId: "inv-1",
      monthlyAmount: 100_000,
      dayOfMonth: 15,
      startDate: "2026-06-01",
    });

    expect(mockPrisma.paymentPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceId: "inv-1",
          monthlyAmount: 100_000,
          dayOfMonth: 15,
        }),
      }),
    );
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" }, data: expect.objectContaining({ status: "INSTALLMENT_PLAN" }) }),
    );
  });

  it("BAD_REQUEST om fakturan redan har en plan", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      status: "INSTALLMENT_PLAN",
    });
    // getByInvoiceId returnerar en AKTIV plan → blockerar.
    mockPrisma.paymentPlan.findFirst.mockResolvedValue({ id: "existing", status: "ACTIVE" });

    await expect(
      makeCaller().createPaymentPlan({
        invoiceId: "inv-1",
        monthlyAmount: 100_000,
        dayOfMonth: 15,
        startDate: "2026-06-01",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.paymentPlan.create).not.toHaveBeenCalled();
  });

  it("BAD_REQUEST om invoice.status inte är SENT", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      status: "DRAFT",
      paymentPlan: null,
    });

    await expect(
      makeCaller().createPaymentPlan({
        invoiceId: "inv-1",
        monthlyAmount: 100_000,
        dayOfMonth: 15,
        startDate: "2026-06-01",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validerar dayOfMonth 1-28 (zod)", async () => {
    await expect(
      makeCaller().createPaymentPlan({
        invoiceId: "inv-1",
        monthlyAmount: 100_000,
        dayOfMonth: 29,
        startDate: "2026-06-01",
      }),
    ).rejects.toThrow();
    expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
  });
});

// ─── cancelPaymentPlan ───────────────────────────────────────────

describe("invoice.cancelPaymentPlan", () => {
  it("sätter plan CANCELLED och invoice tillbaka till SENT", async () => {
    mockPrisma.paymentPlan.findFirst.mockResolvedValue({ id: "plan-1", invoiceId: "inv-1" });
    // Repository-sömmens update läser nuvarande rad (version-bump) före skrivning.
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "inv-1", status: "INSTALLMENT_PLAN" });

    await makeCaller().cancelPaymentPlan({ planId: "plan-1" });

    // objectContaining: repo:t lägger till version/updatedAt i data utöver status.
    expect(mockPrisma.paymentPlan.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "plan-1" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "inv-1" },
      data: expect.objectContaining({ status: "SENT" }),
    }));
  });

  it("NOT_FOUND om planen tillhör annan org", async () => {
    mockPrisma.paymentPlan.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-b").cancelPaymentPlan({ planId: "plan-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.paymentPlan.update).not.toHaveBeenCalled();
  });
});

// ─── writeOff (ADR 0007) ─────────────────────────────────────────

describe("invoice.writeOff", () => {
  it("delbetald → avskriven återstod: skapar WriteOff + härleder BAD_DEBT", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", matterId: "matter-1", amount: 100_000, status: "SENT",
    });
    mockPrisma.payment.findMany.mockResolvedValue([{ amount: 30_000 }]); // betalt
    mockPrisma.invoice.findMany.mockResolvedValue([]); // inga krediteringar
    mockPrisma.writeOff.findMany.mockResolvedValue([]); // inget avskrivet än
    mockPrisma.writeOff.create.mockResolvedValue({ id: "wo-1", invoiceId: "inv-1", amount: 70_000 });
    mockPrisma.invoice.update.mockResolvedValue({ id: "inv-1", status: "BAD_DEBT" });

    const res = await makeCaller().writeOff({ invoiceId: "inv-1", reason: "Konkurs" });

    // amount defaultar till återstoden (100000 − 30000 = 70000)
    expect(mockPrisma.writeOff.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceId: "inv-1", amount: 70_000, reason: "Konkurs" }) }),
    );
    expect(res.outstanding).toBe(0);
    expect(res.status).toBe("BAD_DEBT");
    // Repo.update bumpar version + updatedAt (ADR 0019) → matcha löst på status.
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" }, data: expect.objectContaining({ status: "BAD_DEBT" }) }),
    );
  });

  it("räkna en gång: redan avskriven faktura (outstanding 0) → BAD_REQUEST", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", matterId: "matter-1", amount: 100_000, status: "BAD_DEBT",
      payments: [],
    });
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.writeOff.findMany.mockResolvedValue([{ amount: 100_000 }]); // hela redan avskrivet

    await expect(makeCaller().writeOff({ invoiceId: "inv-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.writeOff.create).not.toHaveBeenCalled();
  });

  it("avskrivningsbelopp > utestående → BAD_REQUEST", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", matterId: "matter-1", amount: 100_000, status: "SENT",
    });
    mockPrisma.payment.findMany.mockResolvedValue([{ amount: 60_000 }]); // betalt
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.writeOff.findMany.mockResolvedValue([]);

    // utestående = 40000; försök skriva av 50000
    await expect(makeCaller().writeOff({ invoiceId: "inv-1", amount: 50_000 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.writeOff.create).not.toHaveBeenCalled();
  });

  it("DRAFT-faktura kan inte skrivas av → BAD_REQUEST", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", matterId: "matter-1", amount: 100_000, status: "DRAFT", payments: [],
    });
    await expect(makeCaller().writeOff({ invoiceId: "inv-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("okänd faktura → NOT_FOUND", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    await expect(makeCaller().writeOff({ invoiceId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── setStatus ───────────────────────────────────────────────────

describe("invoice.setStatus", () => {
  it("DRAFT → SENT", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "inv-1", status: "DRAFT" });
    mockPrisma.invoice.update.mockResolvedValue({ id: "inv-1", status: "SENT" });

    const res = await makeCaller().setStatus({ invoiceId: "inv-1", status: "SENT" });

    expect(res.status).toBe("SENT");
  });

  it("SENT → BAD_DEBT", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "inv-1", status: "SENT" });
    mockPrisma.invoice.update.mockResolvedValue({ id: "inv-1", status: "BAD_DEBT" });

    await makeCaller().setStatus({ invoiceId: "inv-1", status: "BAD_DEBT" });

    // Repo.update bumpar version + updatedAt (ADR 0019) → matcha löst på status.
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-1" },
        data: expect.objectContaining({ status: "BAD_DEBT" }),
      }),
    );
  });

  it("zod tillåter inte godtyckliga statusar (t.ex. PAID)", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeCaller().setStatus({ invoiceId: "inv-1", status: "PAID" as any }),
    ).rejects.toThrow();
  });

  it("NOT_FOUND cross-org", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-b").setStatus({ invoiceId: "inv-1", status: "SENT" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("blockerar omöjlig övergång DRAFT → BAD_DEBT (#350)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "inv-1", status: "DRAFT" });

    await expect(
      makeCaller().setStatus({ invoiceId: "inv-1", status: "BAD_DEBT" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("blockerar övergång från terminalt CANCELLED → SENT (#350)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "inv-1", status: "CANCELLED" });

    await expect(
      makeCaller().setStatus({ invoiceId: "inv-1", status: "SENT" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });
});

// ─── markFortnoxBooked (#82) ─────────────────────────────────────

describe("invoice.markFortnoxBooked", () => {
  it("sätter fortnoxId på obokförd faktura", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "inv-1", fortnoxId: null });
    mockPrisma.invoice.update.mockResolvedValue({ id: "inv-1", fortnoxId: "A/1" });

    const res = await makeCaller().markFortnoxBooked({ invoiceId: "inv-1", fortnoxId: "A/1" });

    expect(res.fortnoxId).toBe("A/1");
    // Repo.update bumpar version + updatedAt (ADR 0019), så matcha löst på fortnoxId.
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-1" },
        data: expect.objectContaining({ fortnoxId: "A/1" }),
      }),
    );
  });

  it("idempotent: skriver INTE över befintlig fortnoxId", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "inv-1", fortnoxId: "A/7" });

    const res = await makeCaller().markFortnoxBooked({ invoiceId: "inv-1", fortnoxId: "A/99" });

    expect(res.fortnoxId).toBe("A/7"); // oförändrad
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("NOT_FOUND cross-org", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-b").markFortnoxBooked({ invoiceId: "inv-1", fortnoxId: "A/1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("zod kräver icke-tom fortnoxId", async () => {
    await expect(
      makeCaller().markFortnoxBooked({ invoiceId: "inv-1", fortnoxId: "" }),
    ).rejects.toThrow();
  });
});

// ─── list / getById ──────────────────────────────────────────────

describe("invoice.list", () => {
  it("filtrerar på matter + organizationId", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    await makeCaller("org-a").list({ matterId: "matter-1" });

    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matter: { organizationId: "org-a" },
          matterId: "matter-1",
        }),
      }),
    );
  });

  it("lägger till invoiceType-filter när angivet", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    await makeCaller().list({ invoiceType: "ACCONTO" });

    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ invoiceType: "ACCONTO" }),
      }),
    );
  });
});

describe("invoice.getById", () => {
  it("NOT_FOUND cross-org", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-b").getById({ id: "inv-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returnerar faktura när i egen org", async () => {
    const full = { id: "inv-1", matter: { id: "m1" }, payments: [], paymentPlan: null };
    mockPrisma.invoice.findFirst.mockResolvedValue(full);

    const res = await makeCaller("org-a").getById({ id: "inv-1" });

    expect(res).toEqual(full);
  });
});

describe("invoice.createCredit", () => {
  it("kastar NOT_FOUND när fakturan tillhör annan org", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().createCredit({ invoiceId: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("kastar BAD_REQUEST när fakturan redan är CREDIT", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      invoiceType: "CREDIT",
      status: "SENT",
      amount: -1000,
      creditNote: null,
      paymentPlan: null,
    });
    await expect(
      makeCaller().createCredit({ invoiceId: "inv-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("kastar BAD_REQUEST när fakturan redan är krediterad", async () => {
    // getByIdInOrg → originalet; getCreditNoteFor ({creditedInvoiceId}) → kreditnota finns.
    mockPrisma.invoice.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) =>
      args?.where?.creditedInvoiceId
        ? { id: "cn1" }
        : { id: "inv-1", invoiceType: "STANDARD", status: "SENT", amount: 1000 });
    await expect(
      makeCaller().createCredit({ invoiceId: "inv-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("kastar BAD_REQUEST när fakturan är CANCELLED", async () => {
    // Ingen kreditnota → getCreditNoteFor passerar → CANCELLED-kollen nås.
    mockPrisma.invoice.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) =>
      args?.where?.creditedInvoiceId
        ? null
        : { id: "inv-1", invoiceType: "STANDARD", status: "CANCELLED", amount: 1000 });
    await expect(
      makeCaller().createCredit({ invoiceId: "inv-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("skapar kreditfaktura med negativt belopp och annullerar originalet", async () => {
    mockPrisma.invoice.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) =>
      args?.where?.creditedInvoiceId || args?.where?.invoiceNumber
        ? null
        : { id: "inv-1", matterId: "m1", invoiceType: "STANDARD", status: "SENT", amount: 1000 });
    mockPrisma.invoice.create.mockResolvedValue({
      id: "credit-1",
      invoiceType: "CREDIT",
      amount: -1000,
    });
    mockPrisma.invoice.update.mockResolvedValue({});

    const res = await makeCaller().createCredit({
      invoiceId: "inv-1",
      notes: "Felaktig",
    });

    expect(res.id).toBe("credit-1");
    expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: -1000,
          invoiceType: "CREDIT",
          status: "SENT",
          creditedInvoiceId: "inv-1",
          notes: "Felaktig",
        }),
      }),
    );
    // Repo.update bumpar version + updatedAt → matcha löst på status.
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" }, data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
  });

  it("avbryter aktiv avbetalningsplan när originalet krediteras", async () => {
    mockPrisma.invoice.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) =>
      args?.where?.creditedInvoiceId || args?.where?.invoiceNumber
        ? null
        : { id: "inv-1", matterId: "m1", invoiceType: "STANDARD", status: "INSTALLMENT_PLAN", amount: 1000 });
    mockPrisma.paymentPlan.findFirst.mockResolvedValue({ id: "pp1", status: "ACTIVE" }); // getByInvoiceId
    mockPrisma.invoice.create.mockResolvedValue({ id: "credit-1" });
    mockPrisma.invoice.update.mockResolvedValue({});
    mockPrisma.paymentPlan.update.mockResolvedValue({});

    await makeCaller().createCredit({ invoiceId: "inv-1" });

    expect(mockPrisma.paymentPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pp1" }, data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
  });
});

// ─── OCR-referens (#182) ─────────────────────────────────────────

describe("OCR-referens på kundfakturor (#182)", () => {
  it("createCredit sätter INGEN ocrReference (krediter betalas inte med OCR)", async () => {
    mockPrisma.invoice.findFirst.mockImplementation((args?: { where?: Record<string, unknown> }) =>
      args?.where?.creditedInvoiceId || args?.where?.invoiceNumber
        ? null
        : { id: "inv-1", matterId: "m1", invoiceType: "STANDARD", status: "SENT", amount: 1000 });
    mockPrisma.invoice.create.mockResolvedValue({ id: "credit-1", invoiceType: "CREDIT", amount: -1000 });
    mockPrisma.invoice.update.mockResolvedValue({});

    await makeCaller().createCredit({ invoiceId: "inv-1" });

    const data = mockPrisma.invoice.create.mock.calls[0]?.[0]?.data as { ocrReference?: string };
    expect(data.ocrReference).toBeUndefined();
  });
});

// ─── recordPayment: extern referens (#181) ───────────────────────

describe("recordPayment med extern referens (#181)", () => {
  it("referensen lagras på betalningen (idempotent betalfils-import)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", amount: 1000, status: "SENT", paymentPlan: null, payments: [],
    });
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-1" });
    mockPrisma.invoice.update.mockResolvedValue({});

    await makeCaller().recordPayment({
      invoiceId: "inv-1", amount: 1000, paidAt: "2026-06-01", reference: "REF-A",
    });

    expect(mockPrisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reference: "REF-A" }) }),
    );
  });
});
