/**
 * När får en kostnadsräkning ångras (#1121)? Bara före domstolens beslut.
 */
import { describe, expect, it } from "bun:test";
import { canVoidKostnadsrakning } from "@/lib/shared/kostnadsrakning-flow";

const inskickad = { status: "PENDING_VERDICT", kostnadsrakningStatus: "INSKICKAD", awardedOre: null, invoiceId: null };

describe("canVoidKostnadsrakning", () => {
  it("inskickad, utan beslut och faktura → får ångras", () => {
    expect(canVoidKostnadsrakning(inskickad)).toBe(true);
  });

  it("efter beslut / överklagan / fakturering → får inte ångras", () => {
    for (const s of ["BESLUTAD", "OVERKLAGAD", "FAKTURERAD"]) {
      expect(canVoidKostnadsrakning({ ...inskickad, kostnadsrakningStatus: s })).toBe(false);
    }
  });

  it("dömt belopp registrerat eller faktura kopplad → får inte ångras", () => {
    expect(canVoidKostnadsrakning({ ...inskickad, awardedOre: 100000 })).toBe(false);
    expect(canVoidKostnadsrakning({ ...inskickad, invoiceId: "inv-1" })).toBe(false);
  });

  it("redan ångrad → inte igen", () => {
    expect(canVoidKostnadsrakning({ ...inskickad, status: "VOIDED" })).toBe(false);
  });
});
