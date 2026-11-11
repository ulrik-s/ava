import { describe, it, expect } from "vitest-compat";
import { isHiddenInvoice, partitionHidden } from "@/lib/shared/hidden-billing-rows";
import type { InvoiceStatus, InvoiceType } from "@/lib/shared/schemas/enums";

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
