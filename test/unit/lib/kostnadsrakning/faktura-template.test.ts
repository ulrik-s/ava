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
    // Äldre rader saknar arvodeskategori (#953) → tidsspillan-normerna räddas ur
    // taxan, resten benämns arvode. Här: 1 626 = arvode, 1 487 = tidsspillan dagtid.
    expect(html).toContain("<td>Arvode</td>");
    expect(html).toContain("Tidsspillan — vardag 08–18");
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

  it("sammanställningen BENÄMNER varje arvodeskategori — inte 'Arvode' fyra gånger (#953)", () => {
    // Efter en retroaktiv taxehöjning bär raden slutregleringsårets taxa men sitt
    // eget datum, så benämningen KAN inte gissas ur beloppet — kategorin måste följa
    // med. Alla fyra kategorierna, var och en på sin 2026-norm.
    const html = renderFakturaHtml({
      invoice: invoice(), recipient: "Domstol (kostnadsräkning)", meta: META,
      spec: spec({
        timeLines: [
          { date: "2025-11-25", description: "Genomgång av handlingar", minutes: 240, amountOre: 650_400, kind: "ARBETE" },
          { date: "2025-12-29", description: "Jourärende under helg", minutes: 120, amountOre: 651_200, kind: "ARBETE_OBEKVAM_TID" },
          { date: "2025-12-17", description: "Restid till sammanträde", minutes: 180, amountOre: 446_100, kind: "TIDSSPILLAN" },
          { date: "2026-05-16", description: "Hemresa efter kvällssammanträde", minutes: 90, amountOre: 146_250, kind: "TIDSSPILLAN_OVRIG_TID" },
        ],
        totalMinutes: 630, arvodeNetOre: 1_893_950, arvodeVatOre: 473_488, grossOre: 2_367_438, payableOre: 2_367_438,
      }),
    });
    expect(html).toContain("<td>Arvode</td>");
    expect(html).toContain("Arvode — obekväm tid (helg/kväll/natt)");
    expect(html).toContain("Tidsspillan — vardag 08–18");
    expect(html).toContain("Tidsspillan — annan tid");
    // Varje kategori får sin egen taxa-rad, ingen sammanslagning.
    expect(html).toContain(`${formatCurrency(325_600)}/tim`);
    expect(html).toContain(`${formatCurrency(97_500)}/tim`);
    // Ordningen är kategori-ordningen (arvode först, tidsspillan sist), inte taxan —
    // annars hamnar helgtaxan (högst) överst.
    expect(html.indexOf("<td>Arvode</td>")).toBeLessThan(html.indexOf("Tidsspillan — vardag"));
    expect(html.indexOf("Tidsspillan — vardag")).toBeLessThan(html.indexOf("Tidsspillan — annan"));
  });

  it("samma kategori på TVÅ taxor (byråns egen taxa ändrad) ger en rad per taxa", () => {
    const html = renderFakturaHtml({
      invoice: invoice(), recipient: "Klient AB", meta: META,
      spec: spec({
        timeLines: [
          { date: "2026-01-10", description: "Arbete före höjning", minutes: 60, amountOre: 250_000, kind: "ARBETE" },
          { date: "2026-06-10", description: "Arbete efter höjning", minutes: 60, amountOre: 280_000, kind: "ARBETE" },
        ],
        totalMinutes: 120, arvodeNetOre: 530_000, arvodeVatOre: 132_500, grossOre: 662_500, payableOre: 662_500,
      }),
    });
    expect(html).toContain(`${formatCurrency(250_000)}/tim`);
    expect(html).toContain(`${formatCurrency(280_000)}/tim`);
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
