/**
 * Tester för ar-summary (ADR 0007): kundfordrings-brygga + åldersanalys.
 */

import { describe, it, expect } from "vitest-compat";
import { computeArBridge, computeAging, scopeArToPeriod } from "@/lib/shared/ar-summary";

const NOW = new Date("2026-06-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("computeArBridge", () => {
  const invoices = [
    { id: "i1", status: "SENT", invoiceType: "STANDARD", amount: 1_000_00, dueDate: daysAgo(10) },
    { id: "i2", status: "PAID", invoiceType: "STANDARD", amount: 500_00, dueDate: daysAgo(40) },
    { id: "i3", status: "BAD_DEBT", invoiceType: "STANDARD", amount: 200_00, dueDate: daysAgo(120) },
    { id: "i4", status: "DRAFT", invoiceType: "STANDARD", amount: 999_00, dueDate: daysAhead(5) }, // exkluderas
    { id: "cred", status: "SENT", invoiceType: "CREDIT", creditedInvoiceId: "i1", amount: -100_00 },
  ];
  const payments = [
    { invoiceId: "i1", amount: 300_00 },
    { invoiceId: "i2", amount: 500_00 }, // i2 fullt betald
    { invoiceId: "i3", amount: 50_00 }, // i3 delbetald
  ];
  const writeOffs = [{ invoiceId: "i3", amount: 150_00 }]; // i3 återstod avskriven

  const bridge = computeArBridge(invoices, payments, writeOffs, NOW);

  it("fakturerat = Σ utställda icke-CREDIT (DRAFT exkluderad)", () => {
    expect(bridge.fakturerat).toBe(1_000_00 + 500_00 + 200_00); // 1 700 00
  });

  it("krediterat = Σ abs(CREDIT)", () => {
    expect(bridge.krediterat).toBe(100_00);
  });

  it("inbetalt + konstaterad kundförlust", () => {
    expect(bridge.inbetalt).toBe(850_00);
    expect(bridge.konstateradKundforlust).toBe(150_00);
  });

  it("invariant: justerat − inbetalt − förlust = utestående", () => {
    expect(bridge.justerat).toBe(bridge.fakturerat - bridge.krediterat);
    expect(bridge.utestaende).toBe(bridge.justerat - bridge.inbetalt - bridge.konstateradKundforlust);
  });

  it("netto realiserat = fakturerat − krediterat − konstaterad förlust (= inbetalt + utestående)", () => {
    expect(bridge.nettoRealiserat).toBe(bridge.fakturerat - bridge.krediterat - bridge.konstateradKundforlust);
    expect(bridge.nettoRealiserat).toBe(bridge.inbetalt + bridge.utestaende);
  });

  it("utestående delas i ej förfallet / förfallet", () => {
    expect(bridge.ejForfallet + bridge.forfallet).toBe(bridge.utestaende);
  });
});

describe("scopeArToPeriod", () => {
  const PERIOD = { from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-30T23:59:59Z") };
  const invoices = [
    { id: "in", status: "SENT", invoiceType: "STANDARD", amount: 100_00, invoiceDate: "2026-06-10" }, // i perioden
    { id: "out", status: "SENT", invoiceType: "STANDARD", amount: 200_00, invoiceDate: "2026-04-10" }, // utanför
    { id: "cred", status: "SENT", invoiceType: "CREDIT", creditedInvoiceId: "in", amount: -10_00, invoiceDate: "2026-07-05" }, // krediterar periodfaktura (senare datum)
  ];
  const payments = [
    { invoiceId: "in", amount: 30_00 },
    { invoiceId: "out", amount: 50_00 },
  ];
  const writeOffs = [{ invoiceId: "out", amount: 5_00 }];

  it("behåller bara fakturor utställda i perioden + deras krediteringar/betalningar", () => {
    const s = scopeArToPeriod(invoices, payments, writeOffs, PERIOD);
    expect(s.invoices.map((i) => i.id).sort()).toEqual(["cred", "in"]); // periodfaktura + dess kredit
    expect(s.payments).toEqual([{ invoiceId: "in", amount: 30_00 }]);
    expect(s.writeOffs).toEqual([]); // writeOff hörde till "out" (utanför)
  });

  it("bryggan på scopad data räknar bara periodens fakturor", () => {
    const s = scopeArToPeriod(invoices, payments, writeOffs, PERIOD);
    const b = computeArBridge(s.invoices, s.payments, s.writeOffs, new Date("2026-07-01T00:00:00Z"));
    expect(b.fakturerat).toBe(100_00); // bara "in"
    expect(b.krediterat).toBe(10_00);
    expect(b.inbetalt).toBe(30_00);
  });
});

describe("computeAging", () => {
  const invoices = [
    { id: "a", status: "SENT", invoiceType: "STANDARD", amount: 100_00, dueDate: daysAgo(10) }, // 0–30
    { id: "b", status: "SENT", invoiceType: "STANDARD", amount: 200_00, dueDate: daysAgo(45) }, // 31–60
    { id: "c", status: "SENT", invoiceType: "STANDARD", amount: 300_00, dueDate: daysAgo(75) }, // 61–90
    { id: "d", status: "SENT", invoiceType: "STANDARD", amount: 400_00, dueDate: daysAgo(200) }, // >90
    { id: "e", status: "SENT", invoiceType: "STANDARD", amount: 500_00, dueDate: daysAhead(10) }, // ej förfallet
  ];

  it("buckar förfallna fakturors utestående mot dueDate", () => {
    const aging = computeAging(invoices, [], [], NOW);
    expect(aging.map((b) => b.amount)).toEqual([100_00, 200_00, 300_00, 400_00]);
    expect(aging.map((b) => b.label)).toEqual(["0–30 dagar", "31–60 dagar", "61–90 dagar", ">90 dagar"]);
  });

  it("betald/avskriven återstod räknas inte i aging", () => {
    const aging = computeAging(
      [{ id: "a", status: "SENT", invoiceType: "STANDARD", amount: 100_00, dueDate: daysAgo(10) }],
      [{ invoiceId: "a", amount: 100_00 }], // fullt betald → outstanding 0
      [],
      NOW,
    );
    expect(aging.every((b) => b.amount === 0)).toBe(true);
  });
});
