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
import { invoiceRouter } from "@/lib/server/routers/invoice";
import { ocrFromInvoiceNumber, isValidOcrReference } from "@/lib/shared/ocr-reference";
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
  payment: {
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
  },
  // $transaction(fn) kör callbacken direkt mot samma mock.
  $transaction: vi.fn(<T,>(fn: (tx: typeof mockPrisma) => Promise<T>) => fn(mockPrisma)),
};

function makeCaller(orgId = "org-a", userId = "user-1") {
  const ctx = {
    user: { id: userId, email: "a@b.com", name: "Test", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
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
});

const MATTER_A = { id: "matter-1", organizationId: "org-a", matterNumber: "2026-0001", title: "T" };

// ─── createAcconto ───────────────────────────────────────────────

describe("invoice.createAcconto", () => {
  it("skapar ACCONTO-faktura med status DRAFT", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(MATTER_A);
    mockPrisma.invoice.create.mockResolvedValue({ id: "inv-1", invoiceType: "ACCONTO", amount: 500_000 });

    const res = await makeCaller().createAcconto({
      matterId: "matter-1",
      amount: 500_000,
      notes: "Förskott på arvodet",
    });

    expect(res.invoiceType).toBe("ACCONTO");
    expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matterId: "matter-1",
          amount: 500_000,
          invoiceType: "ACCONTO",
          status: "DRAFT",
          notes: "Förskott på arvodet",
        }),
      }),
    );
  });

  it("NOT_FOUND när ärendet tillhör annan org", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-b").createAcconto({ matterId: "matter-1", amount: 100_000 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
  });

  it("validerar positivt belopp via zod", async () => {
    await expect(
      makeCaller().createAcconto({ matterId: "matter-1", amount: 0 }),
    ).rejects.toThrow();
    expect(mockPrisma.matter.findFirst).not.toHaveBeenCalled();
  });
});

// ─── createFinal ─────────────────────────────────────────────────

describe("invoice.createFinal", () => {
  const TIME_ENTRIES = [
    // 90 min × 1500 kr/h = 2250 kr = 225 000 öre
    { id: "t1", matterId: "matter-1", minutes: 90, invoiceId: null, user: { hourlyRate: 150_000 } },
    // 30 min × 1500 kr/h = 750 kr = 75 000 öre
    { id: "t2", matterId: "matter-1", minutes: 30, invoiceId: null, user: { hourlyRate: 150_000 } },
  ];
  const EXPENSES = [
    { id: "e1", matterId: "matter-1", amount: 50_000, billable: true, invoiceId: null },
    { id: "e2", matterId: "matter-1", amount: 30_000, billable: false, invoiceId: null }, // skippas
  ];
  const ACCONTOS = [
    { id: "acc1", matterId: "matter-1", invoiceType: "ACCONTO", amount: 200_000 },
  ];

  it("räknar brutto = time + billable expenses, kopplar allt, skapar avdrag", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(MATTER_A);
    mockPrisma.timeEntry.findMany.mockResolvedValue(TIME_ENTRIES);
    mockPrisma.expense.findMany.mockResolvedValue(EXPENSES);
    mockPrisma.invoice.findMany.mockResolvedValue(ACCONTOS);
    mockPrisma.invoice.create.mockResolvedValue({ id: "final-1", invoiceType: "FINAL", amount: 350_000 });

    const res = await makeCaller().createFinal({
      matterId: "matter-1",
      timeEntryIds: ["t1", "t2"],
      expenseIds: ["e1", "e2"],
      accontoInvoiceIds: ["acc1"],
    });

    // Brutto: 225_000 + 75_000 + 50_000 = 350_000 (e2 är !billable → utelämnas)
    expect(res.breakdown.grossAmount).toBe(350_000);
    expect(res.breakdown.accontoDeductionTotal).toBe(200_000);
    expect(res.breakdown.netAmount).toBe(150_000);

    // Fakturan skapas utan nested writes …
    expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matterId: "matter-1",
          amount: 350_000,
          invoiceType: "FINAL",
          status: "DRAFT",
        }),
      }),
    );
    // … posterna kopplas via explicita updateMany + acconto-avdrag via create.
    expect(mockPrisma.timeEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] } },
      data: { invoiceId: "final-1" },
    });
    expect(mockPrisma.expense.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["e1", "e2"] } },
      data: { invoiceId: "final-1" },
    });
    expect(mockPrisma.invoiceAccontoDeduction.create).toHaveBeenCalledWith({
      data: { finalInvoiceId: "final-1", accontoInvoiceId: "acc1" },
    });
  });

  it("BAD_REQUEST om någon time entry redan är fakturerad (eller tillhör annat ärende)", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(MATTER_A);
    // Bad käller efter två, routern får tillbaka bara en → mismatch → throw
    mockPrisma.timeEntry.findMany.mockResolvedValue([TIME_ENTRIES[0]]);

    await expect(
      makeCaller().createFinal({
        matterId: "matter-1",
        timeEntryIds: ["t1", "t2"],
        expenseIds: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
  });

  it("BAD_REQUEST om en acconto redan är avdragen på annan FINAL", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(MATTER_A);
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    mockPrisma.expense.findMany.mockResolvedValue([]);
    // Filtret `deductedOnFinals: { none: {} }` filtrerar bort den → 0 träffar
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    await expect(
      makeCaller().createFinal({
        matterId: "matter-1",
        timeEntryIds: [],
        expenseIds: [],
        accontoInvoiceIds: ["acc1"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("kastar när avdragen överstiger brutto (negativ netto)", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(MATTER_A);
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      { id: "t1", minutes: 60, invoiceId: null, user: { hourlyRate: 100_000 } }, // 1000 kr
    ]);
    mockPrisma.expense.findMany.mockResolvedValue([]);
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: "acc1", matterId: "matter-1", invoiceType: "ACCONTO", amount: 500_000 }, // 5000 kr
    ]);

    await expect(
      makeCaller().createFinal({
        matterId: "matter-1",
        timeEntryIds: ["t1"],
        expenseIds: [],
        accontoInvoiceIds: ["acc1"],
      }),
    ).rejects.toThrow(/negativ/);
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
  });

  it("NOT_FOUND när ärendet tillhör annan org", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);

    await expect(
      makeCaller("org-b").createFinal({
        matterId: "matter-1",
        timeEntryIds: [],
        expenseIds: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
      payments: [{ amount: 200_000 }],
    });
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
      payments: [{ amount: 900_000 }],
    });
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-2", amount: 100_000 });

    const res = await makeCaller().recordPayment({
      invoiceId: "inv-1",
      amount: 100_000,
      paidAt: "2026-05-15",
    });

    expect(res.settled).toBe(true);
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { status: "PAID" },
    });
    expect(mockPrisma.paymentPlan.update).not.toHaveBeenCalled();
  });

  it("full betalning på faktura med plan: PAID + plan COMPLETED", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      amount: 1_000_000,
      status: "INSTALLMENT_PLAN",
      paymentPlan: { id: "plan-1" },
      payments: [{ amount: 999_999 }],
    });
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-last", amount: 1 });

    await makeCaller().recordPayment({
      invoiceId: "inv-1",
      amount: 1,
      paidAt: "2026-05-15",
    });

    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { status: "PAID" },
    });
    expect(mockPrisma.paymentPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { status: "COMPLETED" },
    });
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

  it("vägrar betalning på DRAFT-faktura — PAID kan inte uppstå utan SENT (#350)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", amount: 1_000_000, status: "DRAFT", paymentPlan: null, payments: [],
    });

    await expect(
      makeCaller().recordPayment({ invoiceId: "inv-1", amount: 100_000, paidAt: "2026-05-15" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
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
      payments: [{ amount: 900_000 }],
    });
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
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { status: "INSTALLMENT_PLAN" },
    });
  });

  it("BAD_REQUEST om fakturan redan har en plan", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      status: "INSTALLMENT_PLAN",
      paymentPlan: { id: "existing" },
    });

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

    await makeCaller().cancelPaymentPlan({ planId: "plan-1" });

    expect(mockPrisma.paymentPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { status: "CANCELLED" },
    });
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { status: "SENT" },
    });
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
      payments: [{ amount: 30_000 }],
    });
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
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" }, data: { status: "BAD_DEBT" },
    });
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
      id: "inv-1", matterId: "matter-1", amount: 100_000, status: "SENT", payments: [{ amount: 60_000 }],
    });
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

    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { status: "BAD_DEBT" },
    });
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
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { fortnoxId: "A/1" },
    });
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
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      invoiceType: "STANDARD",
      status: "SENT",
      amount: 1000,
      creditNote: { id: "cn1" },
      paymentPlan: null,
    });
    await expect(
      makeCaller().createCredit({ invoiceId: "inv-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("kastar BAD_REQUEST när fakturan är CANCELLED", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      invoiceType: "STANDARD",
      status: "CANCELLED",
      amount: 1000,
      creditNote: null,
      paymentPlan: null,
    });
    await expect(
      makeCaller().createCredit({ invoiceId: "inv-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("skapar kreditfaktura med negativt belopp och annullerar originalet", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      matterId: "m1",
      invoiceType: "STANDARD",
      status: "SENT",
      amount: 1000,
      creditNote: null,
      paymentPlan: null,
    });
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
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { status: "CANCELLED" },
    });
  });

  it("avbryter aktiv avbetalningsplan när originalet krediteras", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      matterId: "m1",
      invoiceType: "STANDARD",
      status: "INSTALLMENT_PLAN",
      amount: 1000,
      creditNote: null,
      paymentPlan: { id: "pp1", status: "ACTIVE" },
    });
    mockPrisma.invoice.create.mockResolvedValue({ id: "credit-1" });
    mockPrisma.invoice.update.mockResolvedValue({});
    mockPrisma.paymentPlan.update.mockResolvedValue({});

    await makeCaller().createCredit({ invoiceId: "inv-1" });

    expect(mockPrisma.paymentPlan.update).toHaveBeenCalledWith({
      where: { id: "pp1" },
      data: { status: "CANCELLED" },
    });
  });
});

// ─── OCR-referens (#182) ─────────────────────────────────────────

describe("OCR-referens på kundfakturor (#182)", () => {
  it("createAcconto sätter ocrReference härledd ur fakturanumret", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(MATTER_A);
    mockPrisma.invoice.findFirst.mockResolvedValue(null); // nextInvoiceNumber: första
    mockPrisma.invoice.create.mockResolvedValue({ id: "inv-1", invoiceType: "ACCONTO", amount: 100 });

    await makeCaller().createAcconto({ matterId: "matter-1", amount: 100 });

    const data = mockPrisma.invoice.create.mock.calls[0]?.[0]?.data as {
      invoiceNumber?: string; ocrReference?: string;
    };
    expect(data.invoiceNumber).toBeTruthy();
    expect(data.ocrReference).toBe(ocrFromInvoiceNumber(data.invoiceNumber));
    expect(isValidOcrReference(data.ocrReference as string)).toBe(true);
  });

  it("createCredit sätter INGEN ocrReference (krediter betalas inte med OCR)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1", matterId: "m1", invoiceType: "STANDARD", status: "SENT",
      amount: 1000, creditNote: null, paymentPlan: null,
    });
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
