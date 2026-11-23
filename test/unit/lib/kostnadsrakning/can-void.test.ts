/**
 * När får en kostnadsräkning ångras (#1121)? Bara före domstolens beslut.
 */
import { describe, expect, it } from "bun:test";
import { canVoidKostnadsrakning, type KostnadsrakningStatus, type VoidableKostnadsrakning } from "@/lib/shared/kostnadsrakning-flow";

const inskickad: VoidableKostnadsrakning = { status: "PENDING_VERDICT", kostnadsrakningStatus: "INSKICKAD", awardedOre: null, invoiceId: null };

describe("canVoidKostnadsrakning", () => {
  it("inskickad, utan beslut och faktura → får ångras", () => {
    expect(canVoidKostnadsrakning(inskickad)).toBe(true);
  });

  it("efter beslut / överklagan / fakturering → får inte ångras", () => {
    for (const s of ["BESLUTAD", "OVERKLAGAD", "FAKTURERAD"] as const satisfies readonly KostnadsrakningStatus[]) {
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

  it("äldre KR utan status (#1859): ångras som INSKICKAD, men inte med faktura eller skickad", () => {
    const aldre: VoidableKostnadsrakning = { ...inskickad, kostnadsrakningStatus: null };
    expect(canVoidKostnadsrakning(aldre)).toBe(true);
    expect(canVoidKostnadsrakning({ ...aldre, invoiceId: "inv-1" })).toBe(false);
    expect(canVoidKostnadsrakning({ ...aldre, status: "SENT" })).toBe(false);
    expect(canVoidKostnadsrakning({ ...aldre, status: "VOIDED" })).toBe(false);
  });
});
