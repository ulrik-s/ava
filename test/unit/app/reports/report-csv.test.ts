/**
 * Rapporten som CSV (#1793): tre avsnitt i ordning, samma rubriker och summor
 * som tabellerna, cellinnehållet och tomma celler där tabellen visar "—".
 */

import { describe, expect, it, vi } from "vitest-compat";
import {
  COLUMN_LABELS, exportReportCsv, matterLabel, type Report, reportCsvRows, SECTION_TITLES, sumOf, weekLabel,
} from "@/app/reports/_report-csv";
import { toCsv } from "@/lib/shared/csv";
import { asId } from "@/lib/shared/schemas/ids";

const downloadTextFile = vi.fn();
vi.mock("@/lib/client/download-text", () => ({ downloadTextFile }));

const report: Report = {
  scope: "lawyer",
  user: { id: asId<"UserId">("u1"), name: "Anna", hourlyRates: {} },
  period: { from: "2026-01-01", to: "2026-01-11" },
  totals: { totalMinutes: 690, billableMinutes: 480, workValueOre: 1_200_000, expenseOre: 25_000 },
  matters: [
    { matterId: asId<"MatterId">("m1"), matterNumber: "2026-0001", title: "Bodelning", client: "Klient A", paymentMethod: "RATTSHJALP", paymentMethodNote: null, paymentMethodDecidedAt: null,
      totalMinutes: 300, billableMinutes: 240, workValueOre: 600_000, expenseOre: 25_000 },
    { matterId: asId<"MatterId">("m3"), matterNumber: "2026-0003", title: "=Formel", client: null, paymentMethod: "PRIVAT", paymentMethodNote: null, paymentMethodDecidedAt: null,
      totalMinutes: 390, billableMinutes: 240, workValueOre: 600_005, expenseOre: 0 },
  ],
  weeklyRows: [
    { isoYear: 2026, week: 1, start: "2026-01-01", end: "2026-01-04", totalMinutes: 690, billableMinutes: 480, workValueOre: 1_200_005 },
    { isoYear: 2026, week: 2, start: "2026-01-05", end: "2026-01-11", totalMinutes: 0, billableMinutes: 0, workValueOre: 0 },
  ],
  unbilled: {
    rows: [
      { matterId: asId<"MatterId">("m2"), matterNumber: "2026-0002", title: "Tvist", client: "Klient B", paymentMethod: "PRIVAT",
        timeOre: 800_000, expenseOre: 0, total: 800_000 },
      { matterId: asId<"MatterId">("m4"), matterNumber: "2026-0004", title: "Arv", client: null, paymentMethod: "RATTSSKYDD",
        timeOre: 0, expenseOre: 12_345, total: 12_345 },
    ],
    total: 812_345,
  },
};

/** Filens rader, utan BOM. */
const lines = (): string[] => toCsv(reportCsvRows(report)).replace(/^﻿/, "").split("\r\n");

describe("reportCsvRows: avsnitten", () => {
  it("tre avsnitt i ordning, med rubrikrad och en tom rad mellan", () => {
    const l = lines();
    const [m, w, u] = [SECTION_TITLES.matters, SECTION_TITLES.weekly, SECTION_TITLES.unbilled].map((t) => l.indexOf(t));
    expect(m).toBe(0);
    expect(l[(w ?? 0) - 1]).toBe("");
    expect(l[(u ?? 0) - 1]).toBe("");
    expect(m).toBeLessThan(w ?? -1);
    expect(w).toBeLessThan(u ?? -1);
  });

  it("kolumnrubrikerna är konstanterna som tabellerna använder", () => {
    const L = COLUMN_LABELS;
    const l = lines();
    expect(l[1]).toBe([L.matter, L.client, L.payment, L.totalMinutes, L.billableMinutes, L.workValueOre, L.expenseOre].join(";"));
    expect(l).toContain([L.week, L.period, L.totalMinutes, L.billableMinutes, L.workValueOre].join(";"));
    expect(l).toContain([L.matter, L.client, L.payment, L.timeOre, L.expenseOre, L.total].join(";"));
  });

  it("hela filen", () => {
    expect(lines()).toEqual([
      "Ärenden under perioden",
      "Ärende;Klient;Betalning;Tid (h);Deb. tid (h);Arbetsvärde;Utlägg",
      "2026-0001 — Bodelning;Klient A;Rättshjälp;5,00;4,00;6000,00;250,00",
      "2026-0003 — =Formel;;Klient betalar allt själv;6,50;4,00;6000,05;",
      "Summa;;;11,50;8,00;12000,05;250,00",
      "",
      "Timdebitering per vecka",
      "Vecka;Period;Tid (h);Deb. tid (h);Arbetsvärde",
      "2026-v01;2026-01-01 – 2026-01-04;11,50;8,00;12000,05",
      "2026-v02;2026-01-05 – 2026-01-11;;;",
      "Summa;;11,50;8,00;12000,05",
      "",
      "Upparbetat, icke fakturerat",
      "Ärende;Klient;Betalning;Tid;Utlägg;Summa",
      "2026-0002 — Tvist;Klient B;Klient betalar allt själv;8000,00;;8000,00",
      "2026-0004 — Arv;;Rättsskydd;;123,45;123,45",
      "Summa;;;8000,00;123,45;8123,45",
      "",
    ]);
  });

  it("ärendenas utlägg summeras till tom cell när summan är 0, som tabellen", () => {
    const empty: Report = { ...report, matters: [] };
    const l = toCsv(reportCsvRows(empty)).replace(/^﻿/, "").split("\r\n");
    expect(l[2]).toBe("Summa;;;0,00;0,00;0,00;");
  });
});

describe("hjälparna som tabellerna delar", () => {
  it("sumOf summerar fältet", () => {
    expect(sumOf(report.matters, (r) => r.workValueOre)).toBe(1_200_005);
    expect(sumOf([], () => 1)).toBe(0);
  });

  it("matterLabel och weekLabel", () => {
    expect(matterLabel({ matterNumber: "2026-0001", title: "Bodelning" })).toBe("2026-0001 — Bodelning");
    expect(weekLabel({ isoYear: 2026, week: 3 })).toBe("2026-v03");
  });
});

describe("exportReportCsv", () => {
  it("laddar ner tidsrapport_<från>_<till>.csv som text/csv", () => {
    downloadTextFile.mockClear();
    exportReportCsv(report, "2026-01-01", "2026-03-31");
    expect(downloadTextFile).toHaveBeenCalledWith("tidsrapport_2026-01-01_2026-03-31.csv", toCsv(reportCsvRows(report)), "text/csv;charset=utf-8");
  });

  it("utan rapport görs inget", () => {
    downloadTextFile.mockClear();
    exportReportCsv(undefined, "2026-01-01", "2026-03-31");
    exportReportCsv(null, "2026-01-01", "2026-03-31");
    expect(downloadTextFile).not.toHaveBeenCalled();
  });
});
