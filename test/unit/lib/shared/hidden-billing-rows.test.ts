import { describe, it, expect } from "vitest-compat";
import { isHiddenBillingRun, isHiddenInvoice, partitionHidden } from "@/lib/shared/hidden-billing-rows";
import type { BillingRunStatus, BillingRunType, InvoiceStatus, InvoiceType } from "@/lib/shared/schemas/enums";

describe("isHiddenInvoice (#1522)", () => {
  it("döljer annullerade fakturor", () => {
    expect(isHiddenInvoice({ status: "CANCELLED", invoiceType: "STANDARD" })).toBe(true);
  });

  it("döljer kreditfakturor oavsett status", () => {
    expect(isHiddenInvoice({ status: "DRAFT", invoiceType: "CREDIT" })).toBe(true);
    expect(isHiddenInvoice({ status: "SENT", invoiceType: "CREDIT" })).toBe(true);
  });

  it("behåller övriga statusar och typer", () => {
    const statuses: InvoiceStatus[] = ["DRAFT", "SENT", "PAID", "INSTALLMENT_PLAN", "BAD_DEBT"];
    const types: InvoiceType[] = ["STANDARD", "ACCONTO", "FINAL"];
    for (const status of statuses) {
      for (const invoiceType of types) expect(isHiddenInvoice({ status, invoiceType })).toBe(false);
    }
  });
});

describe("isHiddenBillingRun (#1523)", () => {
  it("döljer annullerade körningar, t.ex. en ångrad kostnadsräkning", () => {
    expect(isHiddenBillingRun({ status: "VOIDED", type: "KOSTNADSRAKNING" })).toBe(true);
    expect(isHiddenBillingRun({ status: "VOIDED", type: "ACCONTO" })).toBe(true);
  });

  it("döljer krediteringar oavsett status", () => {
    expect(isHiddenBillingRun({ status: "SENT", type: "CREDIT" })).toBe(true);
    expect(isHiddenBillingRun({ status: "DRAFT", type: "CREDIT" })).toBe(true);
  });

  it("behåller övriga statusar och typer", () => {
    const statuses: BillingRunStatus[] = ["DRAFT", "PENDING_VERDICT", "SENT"];
    const types: BillingRunType[] = ["ACCONTO", "FINAL", "KOSTNADSRAKNING"];
    for (const status of statuses) {
      for (const type of types) expect(isHiddenBillingRun({ status, type })).toBe(false);
    }
  });
});

describe("partitionHidden (#1522)", () => {
  it("delar raderna och bevarar ordningen", () => {
    const { visible, hidden } = partitionHidden([1, 2, 3, 4, 5], (n) => n % 2 === 0);
    expect(visible).toEqual([1, 3, 5]);
    expect(hidden).toEqual([2, 4]);
  });

  it("tom lista ger två tomma delar", () => {
    expect(partitionHidden([], () => true)).toEqual({ visible: [], hidden: [] });
  });
});
