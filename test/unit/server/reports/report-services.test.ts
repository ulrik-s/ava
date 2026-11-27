/**
 * Rapporttjänsterna utbrutna ur rapportroutern (#2176), utan tRPC-kontext:
 * byggstenarna för fryst arbete och advokatrapporten mot riktig
 * DemoDataStore och in-memory-repona. Byråöversikten, "Fakturerat" och
 * kundfordringarna täcks i detalj av routertesterna (reports-*.test.ts).
 */
import { describe, it, expect } from "vitest-compat";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { loadArReport } from "@/lib/server/reports/ar-report";
import { loadBilledReport } from "@/lib/server/reports/billed-report";
import {
  buildFrozenWork, coerceDate, lawyerShareRatios, previousCalendarMonth, runToInvoiceMap, toInvoiceInputs, writtenOffDates,
} from "@/lib/server/reports/billed-work";
import { loadFirmOverview } from "@/lib/server/reports/firm-overview";
import { buildMatters, loadLawyerReport } from "@/lib/server/reports/lawyer-report";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = asId<"OrganizationId">("org-1");
const U1 = asId<"UserId">("u-1");
const U2 = asId<"UserId">("u-2");

describe("billed-work", () => {
  it("coerceDate tar både Date och ISO-sträng", () => {
    const d = new Date("2026-10-01T00:00:00Z");
    expect(coerceDate(d)).toBe(d);
    expect(coerceDate("2026-10-01T00:00:00Z").getTime()).toBe(d.getTime());
  });

  it("runToInvoiceMap hoppar över körningar utan faktura", () => {
    expect([...runToInvoiceMap([{ id: "r-1", invoiceId: "inv-1" }, { id: "r-2", invoiceId: null }, { id: "r-3" }])])
      .toEqual([["r-1", "inv-1"]]);
  });

  it("buildFrozenWork knyter via invoiceId eller körningen, annars inte alls", () => {
    const runs = new Map([["r-1", "inv-2"]]);
    const work = buildFrozenWork([
      { userId: U1, minutes: 90, hourlyRate: 100_000, invoiceId: asId("inv-1") },
      { userId: U2, minutes: 60, hourlyRate: 100_000, frozenByBillingRunId: asId("r-1") },
      { userId: U2, minutes: 60, hourlyRate: 100_000, frozenByBillingRunId: asId("r-okänd") },
      { userId: U2, minutes: 60, hourlyRate: 100_000 },
    ], runs);
    expect(work.map((w) => [String(w.invoiceId), String(w.userId), w.workOre])).toEqual([
      ["inv-1", "u-1", 150_000],
      ["inv-2", "u-2", 100_000],
    ]);
  });

  it("lawyerShareRatios ger advokatens andel per faktura med arbete", () => {
    const ratios = lawyerShareRatios([
      { invoiceId: asId("inv-1"), userId: U1, workOre: 300 },
      { invoiceId: asId("inv-1"), userId: U2, workOre: 100 },
      { invoiceId: asId("inv-2"), userId: U2, workOre: 100 },
      { invoiceId: asId("inv-3"), userId: U1, workOre: 0 },
    ], U1);
    expect([...ratios]).toEqual([["inv-1", 0.75], ["inv-2", 0]]);
  });

  it("writtenOffDates tar den senaste avskrivningen per faktura", () => {
    const dates = writtenOffDates([
      { invoiceId: "inv-1", writtenOffAt: "2026-10-01T00:00:00Z" },
      { invoiceId: "inv-1", writtenOffAt: "2026-10-05T00:00:00Z" },
      { invoiceId: "inv-1", writtenOffAt: "2026-10-03T00:00:00Z" },
      { writtenOffAt: "2026-10-09T00:00:00Z" },
    ]);
    expect([...dates].map(([id, d]) => [id, d.toISOString()])).toEqual([["inv-1", "2026-10-05T00:00:00.000Z"]]);
  });

  it("toInvoiceInputs: avskrivningsposten först, annars updatedAt för BAD_DEBT, annars null", () => {
    const base = { amount: 100, invoiceDate: "2026-10-01T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" };
    const inputs = toInvoiceInputs([
      { ...base, id: "inv-1", status: "BAD_DEBT" },
      { ...base, id: "inv-2", status: "BAD_DEBT" },
      { ...base, id: "inv-3", status: "SENT" },
    ], new Map([["inv-1", new Date("2026-10-05T00:00:00Z")]]));
    expect(inputs.map((i) => i.writtenOffAt?.toISOString() ?? null))
      .toEqual(["2026-10-05T00:00:00.000Z", "2026-10-20T00:00:00.000Z", null]);
  });

  it("previousCalendarMonth ger hela föregående svenska månad, även över årsskiftet", () => {
    const prev = previousCalendarMonth(new Date("2026-01-15T12:00:00Z"));
    expect(prev.from.toISOString()).toBe("2025-11-30T23:00:00.000Z");
    expect(prev.to.toISOString()).toBe("2025-12-31T22:59:59.999Z");
  });
});

const matter = (id: string, matterNumber: string, extra: Record<string, unknown> = {}) => ({
  id, organizationId: "org-1", matterNumber, title: `Ärende ${matterNumber}`, status: "ACTIVE",
  paymentMethod: "PRIVAT", ...extra,
});
const entry = (id: string, matterId: string, day: string, extra: Record<string, unknown> = {}) => ({
  id, organizationId: "org-1", userId: "u-1", matterId, date: new Date(`${day}T09:00:00Z`),
  minutes: 60, hourlyRate: 120_000, billable: true, description: id, ...extra,
});

function setup() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrå" }],
    users: [
      { id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "LAWYER" },
      { id: "u-2", organizationId: "org-1", email: "b@x", name: "Bo", role: "LAWYER" },
    ],
    matters: [matter("m-1", "2026-0002"), matter("m-2", "2026-0001")],
    timeEntries: [
      entry("te-1", "m-1", "2026-10-06"),
      entry("te-2", "m-2", "2026-10-07", { billable: false }),
      entry("te-3", "m-1", "2026-10-20", { invoiceId: "inv-1" }),
    ],
    expenses: [{ id: "ex-1", userId: "u-1", matterId: "m-2", date: new Date("2026-10-08T09:00:00Z"), amount: 5_000, billable: true, description: "x" }],
  }, async () => {});
  return buildInMemoryRepositories(ds);
}

const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };

describe("loadLawyerReport", () => {
  it("en okänd advokat ger null", async () => {
    expect(await loadLawyerReport(setup(), ORG, { ...OCTOBER, userId: asId("finns-ej") })).toBeNull();
  });

  it("ärenden sorterade på nummer, alla veckor i perioden och ofakturerat utan fakturerad tid", async () => {
    const report = await loadLawyerReport(setup(), ORG, { ...OCTOBER, userId: U1 });
    expect(report?.matters.map((m) => [m.matterNumber, m.totalMinutes, m.billableMinutes, m.workValueOre, m.expenseOre]))
      .toEqual([["2026-0001", 60, 0, 0, 5_000], ["2026-0002", 120, 120, 240_000, 0]]);
    expect(report?.weeklyRows.map((w) => w.week)).toEqual([40, 41, 42, 43, 44]);
    expect(report?.weeklyRows.find((w) => w.week === 41)).toMatchObject({ totalMinutes: 120, billableMinutes: 60, workValueOre: 120_000 });
    expect(report?.unbilled.total).toBe(125_000);
    expect(report?.totals).toEqual({ totalMinutes: 180, billableMinutes: 120, workValueOre: 240_000, expenseOre: 5_000 });
  });

  it("ett ärende utan kontakter har ingen klient", () => {
    const ref = {
      id: asId<"MatterId">("m-1"), matterNumber: "1", title: "t", paymentMethod: "PRIVAT" as const,
      paymentMethodNote: null, paymentMethodDecidedAt: null,
    };
    const minutes = { date: new Date(), minutes: 60, billable: true, hourlyRate: 0 };
    expect(buildMatters([{ ...minutes, matter: ref }], [])[0]?.client).toBeNull();
    expect(buildMatters([{ ...minutes, matter: { ...ref, contacts: [{ contact: { name: "Klient AB" } }] } }], [])[0]?.client)
      .toBe("Klient AB");
  });
});

describe("byrå-, fakturerat- och fordringsrapporterna", () => {
  it("byråöversikten har en rad per jurist och totaler som summan av raderna", async () => {
    const overview = await loadFirmOverview(setup(), ORG, OCTOBER);
    expect(overview.lawyers.map((l) => l.name)).toEqual(["Anna", "Bo"]);
    expect(overview.totals.totalMinutes).toBe(180);
    expect(overview.totals.unbilledOre).toBe(125_000);
    expect(overview.period).toEqual(OCTOBER);
  });

  it("fakturerat: null för en okänd advokat, annars perioden och föregående månad", async () => {
    expect(await loadBilledReport(setup(), ORG, { ...OCTOBER, userId: asId("finns-ej") })).toBeNull();
    const billed = await loadBilledReport(setup(), ORG, { ...OCTOBER, userId: U1 });
    expect(billed?.prevPeriod).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(billed?.invoices).toEqual([]);
  });

  it("kundfordringar utan fakturor: tom tabell, med och utan advokat", async () => {
    expect((await loadArReport(setup(), ORG, OCTOBER)).rows).toEqual([]);
    expect((await loadArReport(setup(), ORG, { ...OCTOBER, userId: U1 })).rows).toEqual([]);
  });
});
