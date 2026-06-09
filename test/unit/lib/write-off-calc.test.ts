/**
 * Tester för write-off-calc (ADR 0007): partition-invariant + härledd status.
 */

import { describe, it, expect } from "vitest-compat";
import {
  computeInvoiceLedger,
  deriveInvoiceStatus,
  invoicePartitionViolation,
  type InvoiceLedger,
} from "@/lib/shared/write-off-calc";
import type { InvoiceStatus } from "@/lib/shared/schemas/enums";

describe("computeInvoiceLedger", () => {
  it("outstanding = amount − paid − credited − writtenOff", () => {
    const l = computeInvoiceLedger(100_00, 30_00, 0, 0);
    expect(l.outstanding).toBe(70_00);
  });

  it("delbetald sedan avskriven återstod → outstanding 0", () => {
    // faktura 100, betalt 30, avskrivet återstoden 70
    const l = computeInvoiceLedger(100_00, 30_00, 0, 70_00);
    expect(l).toEqual({ paid: 30_00, credited: 0, writtenOff: 70_00, outstanding: 0 });
  });

  it("översummering ger negativ outstanding (klampas ej)", () => {
    const l = computeInvoiceLedger(100_00, 80_00, 0, 70_00);
    expect(l.outstanding).toBe(-50_00);
  });
});

describe("deriveInvoiceStatus", () => {
  const ledger = (amount: number, paid: number, credited: number, writtenOff: number): InvoiceLedger =>
    computeInvoiceLedger(amount, paid, credited, writtenOff);

  it("avskriven återstod (writtenOff>0, outstanding≤0) → BAD_DEBT", () => {
    expect(deriveInvoiceStatus("SENT", ledger(100_00, 30_00, 0, 70_00))).toBe("BAD_DEBT");
  });

  it("fullt betald (outstanding≤0, inget avskrivet) → PAID", () => {
    expect(deriveInvoiceStatus("SENT", ledger(100_00, 100_00, 0, 0))).toBe("PAID");
    expect(deriveInvoiceStatus("INSTALLMENT_PLAN", ledger(100_00, 100_00, 0, 0))).toBe("PAID");
  });

  it("krediterad i sin helhet → PAID (inget avskrivet)", () => {
    expect(deriveInvoiceStatus("SENT", ledger(100_00, 0, 100_00, 0))).toBe("PAID");
  });

  it("delbetald men fortfarande utestående → behåller stored", () => {
    expect(deriveInvoiceStatus("SENT", ledger(100_00, 30_00, 0, 0))).toBe("SENT");
    expect(deriveInvoiceStatus("INSTALLMENT_PLAN", ledger(100_00, 30_00, 0, 0))).toBe("INSTALLMENT_PLAN");
  });

  it("DRAFT/CANCELLED härleds inte (behålls oavsett ledger)", () => {
    for (const s of ["DRAFT", "CANCELLED"] as InvoiceStatus[]) {
      expect(deriveInvoiceStatus(s, ledger(100_00, 100_00, 0, 0))).toBe(s);
      expect(deriveInvoiceStatus(s, ledger(100_00, 0, 0, 100_00))).toBe(s);
    }
  });
});

describe("invoicePartitionViolation", () => {
  it("giltig partition → null", () => {
    expect(invoicePartitionViolation(100_00, computeInvoiceLedger(100_00, 30_00, 0, 70_00))).toBeNull();
    expect(invoicePartitionViolation(100_00, computeInvoiceLedger(100_00, 0, 0, 0))).toBeNull();
  });

  it("översummering (outstanding < 0) → violation", () => {
    const v = invoicePartitionViolation(100_00, computeInvoiceLedger(100_00, 80_00, 0, 70_00));
    expect(v).toMatch(/Översummerat/);
  });

  it("negativ hink → violation", () => {
    const v = invoicePartitionViolation(100_00, { paid: -1, credited: 0, writtenOff: 0, outstanding: 100_01 });
    expect(v).toMatch(/Negativ avräkningshink/);
  });

  it("handhopsatt ledger där outstanding inte är resten → partition bruten", () => {
    const v = invoicePartitionViolation(100_00, { paid: 10_00, credited: 0, writtenOff: 0, outstanding: 10_00 });
    expect(v).toMatch(/Partition bruten/);
  });
});
