/**
 * `renderFakturaHtml` (#937) — den DELADE faktura-renderaren. Kontraktet är
 * detsamma för ALLA fakturor (aconto, rådgivning, slutfaktura, kredit):
 * sammanställning på första sidan, specifikation därefter.
 *
 * Kostnadsräkningen till domstol har en egen mall och berörs inte.
 */

import { describe, it, expect } from "vitest-compat";
import { fakturaHeading, renderFakturaHtml, type InvoiceSpecification } from "@/lib/client/kostnadsrakning/faktura-template";
import { formatCurrency } from "@/lib/client/utils";
import { asId } from "@/lib/shared/schemas/ids";

const META = { matterNumber: "2026-0010", matterTitle: "Umgängestvist Carlsson" };
const invoice = (over: Record<string, unknown> = {}) => ({
  id: asId<"InvoiceId">("inv-1"), amount: 203_250, vatOre: 40_650,
  invoiceNumber: "F-2026-0007", invoiceDate: "2026-06-30", ...over,
});

const spec = (over: Partial<InvoiceSpecification> = {}): InvoiceSpecification => ({
  timeLines: [], expenseLines: [], totalMinutes: 0,
  arvodeNetOre: 0, arvodeVatOre: 0, expensesNetOre: 0, expensesVatOre: 0, grossOre: 0,
  deductions: [], deductionOre: 0, adjustmentOre: 0, payableOre: 0, ...over,
});

describe("fakturaHeading", () => {
  it("härleds ur fakturatyp — rådgivningstimmen känns igen på notes", () => {
    expect(fakturaHeading({ invoiceType: "FINAL", notes: null })).toBe("Faktura");
    expect(fakturaHeading({ invoiceType: "ACCONTO", notes: null })).toBe("Aconto-faktura");
    expect(fakturaHeading({ invoiceType: "CREDIT", notes: null })).toBe("Kreditfaktura");
    expect(fakturaHeading({ invoiceType: "STANDARD", notes: "Rådgivningstimme enligt rättshjälpstaxan (1 tim)." }))
      .toBe("Rådgivningsfaktura");
  });
});

describe("renderFakturaHtml — sammanställning + specifikation (#937)", () => {
  it("sammanställningen står FÖRE specifikationen, med sidbrytning emellan", () => {
    const html = renderFakturaHtml({
      invoice: invoice(), recipient: "Cecilia Carlsson", meta: META,
      spec: spec({
        timeLines: [{ date: "2026-05-02", description: "Genomgång av handlingar", minutes: 60, amountOre: 162_600 }],
        totalMinutes: 60, arvodeNetOre: 162_600, arvodeVatOre: 40_650, grossOre: 203_250, payableOre: 203_250,
      }),
    });
    expect(html.indexOf("Sammanställning")).toBeGreaterThan(-1);
    expect(html.indexOf("Sammanställning")).toBeLessThan(html.indexOf(">Specifikation<"));
    expect(html.indexOf('class="page-break"')).toBeLessThan(html.indexOf(">Specifikation<"));
    expect(html).toContain("Tidsspecifikation");
  });

  it("fakturor utan egna tidsposter specificeras ur nedbrytningens arbete (#880)", () => {
    // Klientens självrisk-faktura: arbetet ligger på betalar-fakturan, men
    // nedbrytningen bär tidsraderna → specifikationen ska ändå renderas.
    const html = renderFakturaHtml({
      invoice: invoice({ amount: 81_300 }), recipient: "Cecilia Carlsson", meta: META,
      spec: spec({ payableOre: 81_300 }),
      breakdown: {
        timeLines: [
          { date: "2026-05-02", description: "Genomgång av handlingar", minutes: 120, amountOre: 325_200 },
          { date: "2026-05-04", description: "Restid till sammanträde", minutes: 60, amountOre: 148_700 },
        ],
        rows: [
          { label: "Upparbetat arvode (exkl moms)", amountOre: 473_900, kind: "add" },
          { label: "Klientens självrisk 20 % (exkl moms)", amountOre: 65_040, kind: "add" },
        ],
        totalLabel: "Att betala (inkl moms)", totalOre: 81_300,
      },
    });
    expect(html).toContain("Tidsspecifikation");
    expect(html).toContain("Restid till sammanträde");
    // Sammanställningen grupperar på härledd taxa → norm + tidsspillan i 2026.
    expect(html).toContain("Arvode (timkostnadsnorm)");
    expect(html).toContain("Tidsspillan");
    expect(html).toContain(`${formatCurrency(148_700)}/tim`);
    // Uppdelningen (klient/betalare) och fakturans faktiska belopp bevaras.
    expect(html).toContain("Klientens självrisk 20 % (exkl moms)");
    expect(html).toContain(formatCurrency(81_300));
  });

  it("faktura helt utan itemiserat arbete får ändå en förklarande rad ur notes (#870)", () => {
    const html = renderFakturaHtml({
      invoice: invoice({ amount: 203_250, invoiceType: "STANDARD", notes: "Rådgivningstimme enligt rättshjälpstaxan (1 tim)." }),
      recipient: "Cecilia Carlsson", meta: META, spec: spec({ payableOre: 203_250 }),
    });
    expect(html).toContain("Rådgivningsfaktura");
    expect(html).toContain("Sammanställning");
    expect(html).toContain("Rådgivningstimme enligt rättshjälpstaxan (1 tim).");
    expect(html).toContain(formatCurrency(203_250));
    // Rådgivningsnotisen (spegel av KR-notisen) följer med.
    expect(html).toContain("ingår INTE i kostnadsräkningen till domstolen");
    // Inget tomt specifikations-avsnitt när det inte finns något underlag.
    expect(html).not.toContain(">Specifikation<");
  });

  it("utan spec faller mallen tillbaka på netto/moms ur fakturan", () => {
    const html = renderFakturaHtml({ invoice: invoice(), recipient: "Klient AB", meta: META });
    expect(html).toContain("Netto (exkl moms)");
    expect(html).toContain(formatCurrency(203_250 - 40_650));
    expect(html).toContain("Att betala (inkl moms)");
    expect(html).not.toContain("{{");
  });

  it("organisationsuppgifter renderas i foten när de finns", () => {
    const html = renderFakturaHtml({
      invoice: invoice(), recipient: "Klient AB",
      meta: { ...META, organizationName: "Firma AB", organizationOrgNumber: "556677-8899" },
    });
    expect(html).toContain("Firma AB");
    expect(html).toContain("556677-8899");
  });
});
