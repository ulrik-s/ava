/**
 * Byråöversikten (#1016) — `reports.firmOverview`.
 *
 * Körs mot en riktig `DemoDataStore` med två jurister och känd ekonomi, så
 * varje siffra i tabellen går att räkna för hand:
 *
 *   Anna:  120 min à 2 500 kr/h debiterbart OFAKTURERAT   → 5 000 kr upparbetat
 *          60 min à 2 500 kr/h FRYST på faktura F1 (10 000 kr, SENT i perioden)
 *   Bo:    90 min à 2 000 kr/h debiterbart ofakturerat    → 3 000 kr upparbetat
 *          30 min icke-debiterbart (ska bara synas i totalMinutes)
 *
 * F1:s frysta arbete är 100 % Annas → hela fakturabeloppet attribueras henne.
 */

import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-anna"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};

function makeCaller() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrån" }],
    users: [
      { id: "u-anna", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRate: 250_000 },
      { id: "u-bo", organizationId: "org-1", email: "b@x", name: "Bo", role: "LAWYER", hourlyRate: 200_000 },
    ],
    matters: [{
      id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Tvist",
      status: "ACTIVE", paymentMethod: "PRIVAT", createdAt: new Date("2026-01-01"),
    }],
    timeEntries: [
      // Annas ofakturerade arbete i perioden: 120 min × 2 500 kr/h = 5 000 kr.
      { id: "te-a1", organizationId: "org-1", userId: "u-anna", matterId: "m-1", date: new Date("2026-03-10"), minutes: 120, description: "Inlaga", hourlyRate: 250_000, billable: true },
      // Annas FRYSTA arbete → knyter F1 till henne (attributionen, #90).
      { id: "te-a2", organizationId: "org-1", userId: "u-anna", matterId: "m-1", date: new Date("2026-02-01"), minutes: 60, description: "Möte", hourlyRate: 250_000, billable: true, invoiceId: "f-1" },
      // Bos arbete: 90 min × 2 000 kr/h = 3 000 kr ofakturerat + 30 min internt.
      { id: "te-b1", organizationId: "org-1", userId: "u-bo", matterId: "m-1", date: new Date("2026-03-12"), minutes: 90, description: "Utredning", hourlyRate: 200_000, billable: true },
      { id: "te-b2", organizationId: "org-1", userId: "u-bo", matterId: "m-1", date: new Date("2026-03-13"), minutes: 30, description: "Internt", hourlyRate: 200_000, billable: false },
    ],
    invoices: [{
      id: "f-1", organizationId: "org-1", matterId: "m-1", invoiceNumber: "F-2026-001", invoiceType: "FINAL",
      status: "SENT", amount: 1_000_000, amountExclVat: 800_000, vat: 200_000, amountInclVat: 1_000_000,
      invoiceDate: new Date("2026-03-01"), dueDate: new Date("2026-03-31"),
      createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-01"),
    }],
    payments: [{ id: "p-1", organizationId: "org-1", invoiceId: "f-1", amount: 400_000, paidAt: new Date("2026-03-20"), createdAt: new Date("2026-03-20") }],
    expenses: [],
  }, async () => { /* skrivbar store */ });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
}

const PERIOD = { from: "2026-01-01", to: "2026-06-30" };

describe("reports.firmOverview (#1016)", () => {
  it("en rad per jurist med handräknade siffror", async () => {
    const res = await makeCaller().reports.firmOverview(PERIOD);
    expect(res.lawyers.map((l) => l.name).sort()).toEqual(["Anna", "Bo"]);

    const anna = res.lawyers.find((l) => l.name === "Anna")!;
    // 120 ofakturerade + 60 frysta = 180 min arbete i perioden, allt debiterbart.
    expect(anna.totalMinutes).toBe(180);
    expect(anna.billableMinutes).toBe(180);
    expect(anna.workValueOre).toBe(750_000);   // 3 h × 2 500 kr
    expect(anna.unbilledOre).toBe(500_000);    // bara de 120 ofakturerade minuterna
    expect(anna.billedOre).toBe(1_000_000);    // F1 attribueras 100 % Anna

    const bo = res.lawyers.find((l) => l.name === "Bo")!;
    expect(bo.totalMinutes).toBe(120);         // 90 debiterbara + 30 interna
    expect(bo.billableMinutes).toBe(90);
    expect(bo.unbilledOre).toBe(300_000);      // 1,5 h × 2 000 kr
    expect(bo.billedOre).toBe(0);              // inget fryst arbete → ingen attribution
  });

  it("totalerna är summan av raderna", async () => {
    const res = await makeCaller().reports.firmOverview(PERIOD);
    const sum = (f: (l: (typeof res.lawyers)[number]) => number): number => res.lawyers.reduce((s, l) => s + f(l), 0);
    expect(res.totals.totalMinutes).toBe(sum((l) => l.totalMinutes));
    expect(res.totals.workValueOre).toBe(sum((l) => l.workValueOre));
    expect(res.totals.unbilledOre).toBe(sum((l) => l.unbilledOre));
    expect(res.totals.billedOre).toBe(sum((l) => l.billedOre));
    expect(res.totals.unbilledOre).toBe(800_000); // 5 000 + 3 000 kr
  });

  it("fordringsläget scopas till perioden", async () => {
    const res = await makeCaller().reports.firmOverview(PERIOD);
    expect(res.ar.fakturerat).toBe(1_000_000);
    expect(res.ar.inbetalt).toBe(400_000);
    expect(res.ar.utestaende).toBe(600_000);
    // Faktura utanför perioden ska inte synas: fråga en period före fakturan.
    const before = await makeCaller().reports.firmOverview({ from: "2025-01-01", to: "2025-12-31" });
    expect(before.ar.fakturerat).toBe(0);
    expect(before.totals.totalMinutes).toBe(0);
  });

  it("perioden avgränsar juristernas rader, inte bara fordringarna", async () => {
    // Bara mars: Annas frysta 60 min (februari) faller bort ur arbetet, men
    // fakturan (utställd 1 mars) ligger kvar i fakturerat.
    const res = await makeCaller().reports.firmOverview({ from: "2026-03-01", to: "2026-03-31" });
    const anna = res.lawyers.find((l) => l.name === "Anna")!;
    expect(anna.totalMinutes).toBe(120);
    expect(anna.billedOre).toBe(1_000_000);
  });
});
