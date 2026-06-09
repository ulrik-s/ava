/**
 * Tester för write-off-migration (ADR 0007): migrate-on-read av legacy-BAD_DEBT
 * → syntetisk WriteOff. Fokus: korrekt belopp/datum + idempotens.
 */

import { describe, it, expect } from "vitest-compat";
import { synthesizeBadDebtWriteOffs, MIGRATION_RECORDED_BY } from "@/lib/shared/write-off-migration";

const inv = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", status: "BAD_DEBT", amount: 100_00, invoiceType: "STANDARD",
  updatedAt: "2026-05-01T00:00:00Z", dueDate: "2026-04-01T00:00:00Z", ...over,
});

describe("synthesizeBadDebtWriteOffs", () => {
  it("BAD_DEBT utan WriteOff → syntetisk WriteOff på återstoden", () => {
    const out = synthesizeBadDebtWriteOffs([inv()], [{ invoiceId: "inv-1", amount: 30_00 }], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      invoiceId: "inv-1", amount: 70_00, recordedById: MIGRATION_RECORDED_BY, migrated: true,
    });
    // writtenOffAt uppskattas till updatedAt (senaste mutationsdatum)
    expect(out[0]!.writtenOffAt).toBe("2026-05-01T00:00:00Z");
  });

  it("idempotent: faktura som redan har en WriteOff hoppas", () => {
    const existing = [{ invoiceId: "inv-1", amount: 70_00 }];
    const out = synthesizeBadDebtWriteOffs([inv()], [{ invoiceId: "inv-1", amount: 30_00 }], existing);
    expect(out).toEqual([]);
  });

  it("idempotent: kör två gånger (mata in förra rundans output) → inget nytt", () => {
    const payments = [{ invoiceId: "inv-1", amount: 30_00 }];
    const round1 = synthesizeBadDebtWriteOffs([inv()], payments, []);
    const round2 = synthesizeBadDebtWriteOffs([inv()], payments, round1);
    expect(round1).toHaveLength(1);
    expect(round2).toEqual([]);
  });

  it("drar av krediteringar (CREDIT-faktura) från återstoden", () => {
    const invoices = [inv(), { id: "cred-1", invoiceType: "CREDIT", creditedInvoiceId: "inv-1", amount: -20_00 }];
    const out = synthesizeBadDebtWriteOffs(invoices, [{ invoiceId: "inv-1", amount: 30_00 }], []);
    // 10000 − 3000 betalt − 2000 krediterat = 5000 återstår
    expect(out[0]!.amount).toBe(50_00);
  });

  it("ingen återstod (fullt betald BAD_DEBT) → ingen WriteOff", () => {
    const out = synthesizeBadDebtWriteOffs([inv()], [{ invoiceId: "inv-1", amount: 100_00 }], []);
    expect(out).toEqual([]);
  });

  it("icke-BAD_DEBT-fakturor rörs inte", () => {
    const out = synthesizeBadDebtWriteOffs([inv({ status: "SENT" }), inv({ id: "inv-2", status: "PAID" })], [], []);
    expect(out).toEqual([]);
  });

  it("fallback-datum när updatedAt saknas → dueDate", () => {
    const out = synthesizeBadDebtWriteOffs([inv({ updatedAt: undefined })], [], []);
    expect(out[0]!.writtenOffAt).toBe("2026-04-01T00:00:00Z");
  });
});
