/**
 * `renderFakturaHtml` (#937) — den DELADE faktura-renderaren. Kontraktet är
 * detsamma för ALLA fakturor (aconto, rådgivning, slutfaktura, kredit):
 * sammanställning på första sidan, specifikation därefter.
 *
 * Kostnadsräkningen till domstol har en egen mall och berörs inte.
 */

import { describe, it, expect } from "vitest-compat";
import { buildFakturaView, fakturaHeading, renderFakturaHtml, type InvoiceSpecification } from "@/lib/client/kostnadsrakning/faktura-template";
import { formatCurrency } from "@/lib/client/utils";
import { tidsspillanOvrigFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { buildInvoiceSpecification } from "@/lib/shared/invoice-specification";
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

// ── Uträkningen ska gå att räkna efter (#1200) ───────────────────────────────

/** Heltals-"formatering" → raderna kan läsas tillbaka som tal och räknas efter. */
const ore: (o: number) => string = (o) => String(o);

/**
 * Varje summarad = summan av alla belopp-rader ovanför den, och slutsumman =
 * summan av alla belopp-rader (summarader räknas inte två gånger). Returnerar
 * den löpande summan så testet kan jämföra den med slutsumman.
 */
function reconcile(rows: ReadonlyArray<{ amount: string; subtotal: boolean; label: string }>): number {
  let running = 0;
  for (const r of rows) {
    if (r.subtotal) expect({ label: r.label, amount: Number(r.amount) }).toEqual({ label: r.label, amount: running });
    else running += Number(r.amount);
  }
  return running;
}

/** Realistisk faktura: arbete (två poster, samma pris) + tidsspillan + utlägg +
 *  äkta utlägg + ett avdraget aconto. Byggd med den KANONISKA builden. */
function realisticSpec(): InvoiceSpecification {
  const timeLines = [
    { date: "2026-05-02", description: "Genomgång av handlingar", minutes: 150, amountOre: 375_000, kind: "ARBETE" as const },
    { date: "2026-05-04", description: "Restid till tingsrätten", minutes: 90, amountOre: 150_000, kind: "TIDSSPILLAN" as const },
    { date: "2026-05-04", description: "Huvudförhandling", minutes: 60, amountOre: 150_000, kind: "ARBETE" as const },
  ];
  const expenseLines = [
    { date: "2026-05-04", description: "Tågbiljett", netOre: 90_000, grossOre: 112_500 },
    { date: "2026-05-05", description: "Registerutdrag (äkta utlägg)", netOre: 50_000, grossOre: 50_000, passThrough: true },
  ];
  const deductions = [{ invoiceNumber: "F-2026-0003", date: "2026-04-01", amountOre: 200_000 }];
  const base = buildInvoiceSpecification({ timeLines, expenseLines, deductions, payableOre: 0 });
  return buildInvoiceSpecification({ timeLines, expenseLines, deductions, payableOre: base.grossOre - 200_000 });
}

describe("buildFakturaView — sammanställningen är en uträkning (#1200)", () => {
  const s = realisticSpec();
  const v = buildFakturaView({ invoice: invoice({ amount: s.payableOre }), recipient: "Klient AB", meta: META, spec: s }, ore);

  it("arvoderaderna läses som tim × timpris = belopp, arvode före tidsspillan", () => {
    expect(v.summary.slice(0, 2)).toEqual([
      { label: "Arvode", hours: "3,5", rateLabel: "150000/tim", amount: "525000", subtotal: false },
      { label: "Tidsspillan — vardag 08–18", hours: "1,5", rateLabel: "100000/tim", amount: "150000", subtotal: false },
    ]);
  });

  it("kedjan: summa arvode → moms → utlägg → moms → äkta utlägg → summa inkl moms", () => {
    expect(v.summary.map((r) => r.label)).toEqual([
      "Arvode", "Tidsspillan — vardag 08–18",
      "Summa arvode exkl moms", "Moms 25 % på arvode",
      "Utlägg exkl moms", "Moms 25 % på utlägg", "Äkta utlägg (utan moms)",
    ]);
    expect(v.summary.filter((r) => r.subtotal).map((r) => r.label)).toEqual(["Summa arvode exkl moms"]);
    expect(v.summaryTotalLabel).toBe("Summa inkl moms");
  });

  it("varje visad summa = raderna ovanför, med spec:ens egna momsbelopp", () => {
    expect(reconcile(v.summary)).toBe(Number(v.summaryTotal));
    expect(Number(v.summaryTotal)).toBe(s.grossOre);
    const amountOf = (label: string) => Number(v.summary.find((r) => r.label === label)?.amount);
    expect(amountOf("Moms 25 % på arvode")).toBe(s.arvodeVatOre);
    expect(amountOf("Moms 25 % på utlägg")).toBe(s.expensesVatOre);
    expect(amountOf("Utlägg exkl moms") + amountOf("Äkta utlägg (utan moms)")).toBe(s.expensesNetOre);
  });

  it("summa inkl moms − aconto = att betala", () => {
    expect(v.hasSplit).toBe(true);
    expect(v.splitRows).toEqual([{ label: "Avgår aconto — faktura F-2026-0003 (2026-04-01)", amount: "−200000", style: "color:#b45309", muted: true }]);
    expect(Number(v.summaryTotal) - 200_000).toBe(Number(v.total));
  });

  it("tidsspecifikationen delas per kategori, med timpris och delsumma", () => {
    expect(v.timeGroups.map((g) => [g.label, g.subtotalLabel, g.hours, g.amount])).toEqual([
      ["Arvode", "Summa arvode", "3,5", "525000"],
      ["Tidsspillan — vardag 08–18", "Summa tidsspillan — vardag 08–18", "1,5", "150000"],
    ]);
    expect(v.timeGroups[0]?.lines.map((l) => [l.description, l.hours, l.rate, l.amount])).toEqual([
      ["Genomgång av handlingar", "2,5", "150000/tim", "375000"],
      ["Huvudförhandling", "1", "150000/tim", "150000"],
    ]);
    // Delsummorna = posterna i deltabellen, och tillsammans = summa arvode exkl moms.
    for (const g of v.timeGroups) expect(g.lines.reduce((acc, l) => acc + Number(l.amount), 0)).toBe(Number(g.amount));
    expect(v.timeGroups.reduce((acc, g) => acc + Number(g.amount), 0)).toBe(s.arvodeNetOre);
    // Den platta listan (byrå-mallar, #852) bär också timpriset, i fakturans ordning.
    expect(v.timeLines.map((l) => l.rate)).toEqual(["150000/tim", "100000/tim", "150000/tim"]);
  });
});

describe("buildFakturaView — kantfall i uträkningen (#1200)", () => {
  it("nollrader utelämnas (inga utlägg → ingen utläggs-/utläggsmomsrad)", () => {
    const s = buildInvoiceSpecification({
      timeLines: [{ date: "2026-05-02", description: "Möte", minutes: 60, amountOre: 150_000, kind: "ARBETE" }],
      expenseLines: [], deductions: [], payableOre: 187_500,
    });
    const v = buildFakturaView({ invoice: invoice({ amount: 187_500 }), recipient: "K", meta: META, spec: s }, ore);
    expect(v.summary.map((r) => r.label)).toEqual(["Arvode", "Summa arvode exkl moms", "Moms 25 % på arvode"]);
    expect(reconcile(v.summary)).toBe(187_500);
    expect(v.hasSplit).toBe(false);
  });

  it("per-dygns-kategorier visas som dygn × dagbelopp, inte som timpris", () => {
    const s = buildInvoiceSpecification({
      timeLines: [
        { date: "2026-05-02", description: "Beredskap lördag", minutes: 0, amountOre: 250_000, kind: "ADVOKATBEREDSKAP" },
        { date: "2026-05-03", description: "Beredskap söndag", minutes: 0, amountOre: 250_000, kind: "ADVOKATBEREDSKAP" },
      ],
      expenseLines: [], deductions: [], payableOre: 625_000,
    });
    const v = buildFakturaView({ invoice: invoice({ amount: 625_000 }), recipient: "K", meta: META, spec: s }, ore);
    expect(v.summary[0]).toEqual({ label: "Advokatberedskap — garantiersättning per dag", hours: "2 dygn", rateLabel: "250000/dygn", amount: "500000", subtotal: false });
    expect(v.timeGroups[0]?.hours).toBe("2 dygn");
    expect(v.timeGroups[0]?.lines[0]).toMatchObject({ hours: "1 dygn", rate: "250000/dygn" });
    expect(reconcile(v.summary)).toBe(Number(v.summaryTotal));
  });

  it("post utan tid och belopp får inget påhittat timpris", () => {
    const s = buildInvoiceSpecification({
      timeLines: [{ date: "2026-05-02", description: "Notering", minutes: 0, amountOre: 0, kind: "ARBETE" }],
      expenseLines: [], deductions: [], payableOre: 0,
    });
    const v = buildFakturaView({ invoice: invoice({ amount: 0 }), recipient: "K", meta: META, spec: s }, ore);
    expect(v.summary[0]?.rateLabel).toBe("");
    expect(v.timeLines[0]?.rate).toBe("");
  });

  it("äldre rader utan kategori: tidsspillan annan tid räddas ur taxan till egen deltabell", () => {
    const ovrig = tidsspillanOvrigFtaxForDate("2026-05-04");
    const v = buildFakturaView({
      invoice: invoice(), recipient: "K", meta: META,
      spec: buildInvoiceSpecification({
        timeLines: [
          { date: "2026-05-04", description: "Hemresa kväll", minutes: 60, amountOre: ovrig },
          { date: "2026-05-02", description: "Genomgång", minutes: 60, amountOre: 162_600 },
        ],
        expenseLines: [], deductions: [], payableOre: 0,
      }),
    }, ore);
    expect(v.timeGroups.map((g) => g.label)).toEqual(["Arvode", "Tidsspillan — annan tid"]);
  });

  it("slutregleringens nedbrytning (utan egen spec) ger ändå en kedja som går ihop", () => {
    const v = buildFakturaView({
      invoice: invoice({ amount: 81_300 }), recipient: "K", meta: META,
      breakdown: {
        timeLines: [
          { date: "2026-05-02", description: "Genomgång", minutes: 120, amountOre: 325_200, kind: "ARBETE" },
          { date: "2026-05-04", description: "Restid", minutes: 60, amountOre: 148_700, kind: "TIDSSPILLAN" },
        ],
        rows: [{ label: "Klientens självrisk 20 % (inkl moms)", amountOre: 81_300, kind: "add" }],
        totalLabel: "Att betala (inkl moms)", totalOre: 81_300,
      },
    }, ore);
    expect(Number(v.summaryTotal)).toBe(Math.round((325_200 + 148_700) * 1.25));
    expect(reconcile(v.summary)).toBe(Number(v.summaryTotal));
    expect(v.total).toBe("81300");
  });

  it("faktura utan itemiserat arbete: en rad ur notes, ingen summarad", () => {
    const v = buildFakturaView({ invoice: invoice({ notes: "Aconto" }), recipient: "K", meta: META }, ore);
    expect(v.summary).toEqual([{ label: "Aconto", rateLabel: "", hours: "", amount: "203250", subtotal: false }]);
    expect(v.summaryTotalLabel).toBe("Summa inkl moms");
    expect(v.timeGroups).toEqual([]);
  });
});

describe("renderFakturaHtml — kolumner och deltabeller (#1200)", () => {
  const html = renderFakturaHtml({ invoice: invoice(), recipient: "Klient AB", meta: META, spec: realisticSpec() });

  it("sammanställningen har kolumnerna Benämning | Tim | Timpris | Belopp och fet summarad", () => {
    expect(html).toContain("<th>Benämning</th><th style=\"text-align:right\">Tim</th><th style=\"text-align:right\">Timpris</th><th style=\"text-align:right\">Belopp</th>");
    expect(html).toContain(`<tr style="border-top:1px solid #ccc;font-weight:bold"><td>Summa arvode exkl moms</td>`);
    expect(html).toContain(">Summa inkl moms<");
    expect(html).not.toContain("Timtaxa");
  });

  it("tidsspecifikationen har en deltabell per kategori med delsumma", () => {
    expect(html).toContain("<h4 style=\"font-size:13px;margin-top:1rem;margin-bottom:.25rem\">Arvode</h4>");
    expect(html.indexOf(">Arvode</h4>")).toBeLessThan(html.indexOf(">Tidsspillan — vardag 08–18</h4>"));
    expect(html).toContain(`<td colspan="2">Summa tidsspillan — vardag 08–18</td><td style="text-align:right">1,5</td>`);
    expect(html).toContain(`${formatCurrency(150_000)}/tim`);
    expect(html).not.toContain("{{");
  });
});
