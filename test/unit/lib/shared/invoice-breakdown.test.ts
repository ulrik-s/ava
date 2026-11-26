/**
 * `invoiceBreakdown` (#2180): acontofakturans egen kolumn går före
 * `settlementBreakdown`, som slutfakturan och äldre acontofakturor har.
 */
import { describe, expect, it } from "vitest-compat";
import { invoiceBreakdown } from "@/lib/shared/settlement-view";

const view = (totalOre: number) => ({ timeLines: [], rows: [], totalLabel: "Att betala", totalOre });

describe("invoiceBreakdown", () => {
  it("acontots egen kolumn går före settlementBreakdown", () => {
    expect(invoiceBreakdown({ accontoBreakdown: view(1), settlementBreakdown: view(2) })).toEqual(view(1));
  });

  it("utan egen kolumn: settlementBreakdown (slutfakturan, äldre aconton)", () => {
    expect(invoiceBreakdown({ accontoBreakdown: null, settlementBreakdown: view(2) })).toEqual(view(2));
    expect(invoiceBreakdown({ settlementBreakdown: view(3) })).toEqual(view(3));
  });

  it("ingen nedbrytning → null", () => {
    expect(invoiceBreakdown({})).toBeNull();
    expect(invoiceBreakdown({ accontoBreakdown: undefined, settlementBreakdown: null })).toBeNull();
  });
});
