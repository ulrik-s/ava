/**
 * `billingActionItems` (#1221): faktureringsåtgärder som väntar blir poster i
 * Att bevaka — och försvinner när läget ändras.
 */
import { describe, expect, it } from "vitest-compat";
import { billingActionItems, UNSENT_INVOICE_GRACE_DAYS, type BillingActionMatter } from "@/lib/shared/watchlist";

const NOW = new Date("2026-09-20T10:00:00Z");

function matter(extra: Partial<BillingActionMatter> = {}): BillingActionMatter {
  return {
    id: "m1", matterNumber: "AA2026-0001", paymentMethod: "PRIVAT", runs: [], invoices: [],
    radgivningEntryMissing: false, sjalvriskClientOre: null, sjalvriskThresholdOre: 150_000, ...extra,
  };
}

const titles = (m: BillingActionMatter): string[] => billingActionItems([m], NOW).map((i) => i.title);

describe("billingActionItems", () => {
  it("inget att göra → inga poster", () => {
    expect(billingActionItems([matter()], NOW)).toEqual([]);
  });

  it("skapad men oskickad faktura → 'Skicka faktura', länkad till ärendet", () => {
    const [item] = billingActionItems([matter({
      invoices: [{ id: "i1", invoiceNumber: "F-2026-0012", status: "DRAFT", amountOre: 5000, day: "2026-09-18" }],
    })], NOW);
    expect(item).toMatchObject({
      kind: "billingAction", severity: "approaching", title: "Skicka faktura F-2026-0012",
      matterId: "m1", matterNumber: "AA2026-0001", at: "2026-09-18", amountOre: 5000,
      link: { route: "matters", id: "m1" },
    });
  });

  it(`oskickad i mer än ${UNSENT_INVOICE_GRACE_DAYS} dagar → passerad`, () => {
    const [item] = billingActionItems([matter({
      invoices: [{ id: "i1", invoiceNumber: null, status: "DRAFT", amountOre: 5000, day: "2026-09-10" }],
    })], NOW);
    expect(item).toMatchObject({ severity: "passed", title: "Skicka faktura", detail: "Skapad för 10 dagar sedan men inte skickad." });
  });

  it("utan fakturadatum räknas den som ny; skickade fakturor ignoreras", () => {
    const items = billingActionItems([matter({
      invoices: [
        { id: "i1", invoiceNumber: "F-1", status: "DRAFT", amountOre: 1, day: null },
        { id: "i2", invoiceNumber: "F-2", status: "SENT", amountOre: 1, day: "2026-01-01" },
      ],
    })], NOW);
    expect(items.map((i) => [i.title, i.severity])).toEqual([["Skicka faktura F-1", "approaching"]]);
  });

  it("inget betalningssätt → 'Välj betalningssätt'", () => {
    expect(titles(matter({ paymentMethod: null }))).toEqual(["Välj betalningssätt"]);
  });

  it("rådgivningsposten saknas → 'Markera rådgivningsmötet som rådgivning'", () => {
    expect(titles(matter({ radgivningEntryMissing: true }))).toEqual(["Markera rådgivningsmötet som rådgivning"]);
  });

  it("självrisken över tröskeln → 'Skicka självrisk-aconto (belopp)'; under tröskeln inget", () => {
    const [item] = billingActionItems([matter({ paymentMethod: "RATTSHJALP", sjalvriskClientOre: 160_000 })], NOW);
    expect(item?.title.replace(/\s/g, " ")).toBe("Skicka självrisk-aconto (1 600,00 kr)");
    expect(item?.amountOre).toBe(160_000);
    expect(titles(matter({ paymentMethod: "RATTSHJALP", sjalvriskClientOre: 100_000 }))).toEqual([]);
    expect(titles(matter({ paymentMethod: "RATTSHJALP", sjalvriskClientOre: null }))).toEqual([]);
  });

  it("försäkringens prutning inte registrerad → 'Registrera försäkringsbolagets prutning'", () => {
    expect(titles(matter({
      paymentMethod: "RATTSSKYDD", runs: [{ type: "FINAL", status: "SENT", recipient: "FORSAKRING" }],
    }))).toEqual(["Registrera försäkringsbolagets prutning"]);
  });

  it("kostnadsräkning väntar på beslut → tingsrätt resp. hovrätt", () => {
    const run = { type: "KOSTNADSRAKNING" as const, status: "PENDING_VERDICT" as const, recipient: "DOMSTOL" as const };
    expect(titles(matter({ paymentMethod: "OFFENTLIGT_UPPDRAG", runs: [{ ...run, kostnadsrakningStatus: "INSKICKAD" }] })))
      .toEqual(["Registrera domstolens beslut på kostnadsräkningen"]);
    expect(titles(matter({ paymentMethod: "OFFENTLIGT_UPPDRAG", runs: [{ ...run, kostnadsrakningStatus: "OVERKLAGAD" }] })))
      .toEqual(["Registrera hovrättens beslut på kostnadsräkningen"]);
    expect(titles(matter({ paymentMethod: "OFFENTLIGT_UPPDRAG", runs: [{ ...run, kostnadsrakningStatus: "FAKTURERAD" }] })))
      .toEqual([]);
  });

  it("beslutad kostnadsräkning → 'Skapa faktura för kostnadsräkningen (dömt belopp)'; hovrättsvariant; försvinner när fakturerad (#1225)", () => {
    const run = { type: "KOSTNADSRAKNING" as const, status: "PENDING_VERDICT" as const, recipient: "DOMSTOL" as const, kostnadsrakningStatus: "BESLUTAD" as const };
    const [tr] = billingActionItems([matter({ paymentMethod: "OFFENTLIGT_UPPDRAG", runs: [{ ...run, awardedOre: 100_000 }] })], NOW);
    expect(tr).toMatchObject({ kind: "billingAction", detail: "Domstolens beslut är registrerat.", amountOre: 100_000 });
    expect(tr!.title.replace(/\s/g, " ")).toBe("Skapa faktura för kostnadsräkningen (1 000,00 kr)");
    const [hr] = billingActionItems([matter({ paymentMethod: "OFFENTLIGT_UPPDRAG", runs: [{ ...run, beslutSlutgiltigt: true, awardedOre: null }] })], NOW);
    expect(hr).toMatchObject({ title: "Skapa faktura för kostnadsräkningen", detail: "Hovrättens beslut är registrerat.", amountOre: null });
    expect(titles(matter({ paymentMethod: "OFFENTLIGT_UPPDRAG", runs: [{ ...run, kostnadsrakningStatus: "FAKTURERAD", awardedOre: 100_000 }] })))
      .toEqual([]);
  });
});
