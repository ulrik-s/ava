/**
 * Kostnadsräkningens per-kategori-värdering (#891): arbete på timkostnadsnormen,
 * tidsspillan på tidsspillan-normen — INTE "summa timmar × en taxa". Varje rad får
 * á-pris + belopp; arvodet = summan av raderna.
 */

import { describe, it, expect } from "vitest-compat";
import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";

describe("kostnadsräkning per kategori (#891)", () => {
  it("värderar arbete och tidsspillan på olika normer och summerar radvis", () => {
    const res = buildKostnadsrakningContext({
      matter: { matterNumber: "2026-0020", title: "Test", radgivningPaid: false },
      defender: { name: "Adv" },
      hufStart: "2026-05-01T09:00:00", hufEnd: "2026-05-01T09:00:00", // ingen HUF
      isTaxeArende: false, hasFTax: true,
      expenses: [],
      timeEntries: [
        { id: "t1", date: "2026-03-01", description: "Arbete", minutes: 60, billable: true, kind: "ARBETE" },
        { id: "t2", date: "2026-03-02", description: "Restid", minutes: 60, billable: true, kind: "TIDSSPILLAN" },
      ],
    });
    const lines = res.templateContext.timeLines as Array<{ rateOrePerH: number; amountOre: number; isTidsspillan: boolean }>;
    const arbete = lines.find((l) => !l.isTidsspillan)!;
    const tids = lines.find((l) => l.isTidsspillan)!;
    expect(arbete.rateOrePerH).toBe(162_600); // 1 626 kr/h
    expect(tids.rateOrePerH).toBe(148_700);   // 1 487 kr/h (egen, lägre norm)
    // Arvodet = summan av raderna, INTE 2h × 1626.
    expect(res.arvodeExclVat).toBe(162_600 + 148_700);
    expect(res.arvodeExclVat).not.toBe(2 * 162_600);
  });

  it("2025-daterade poster värderas ändå på KR-datumets (2026) norm — retroaktivt", () => {
    const res = buildKostnadsrakningContext({
      matter: { matterNumber: "x", title: "T", radgivningPaid: false },
      defender: { name: "A" },
      hufStart: "2026-06-01T09:00:00", hufEnd: "2026-06-01T09:00:00",
      isTaxeArende: false, hasFTax: true, expenses: [],
      timeEntries: [{ id: "t1", date: "2025-11-15", description: "Arbete 2025", minutes: 60, billable: true, kind: "ARBETE" }],
    });
    expect(res.arvodeExclVat).toBe(162_600); // 2026 års norm, inte 2025 (160 200)
  });
});
