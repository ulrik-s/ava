/**
 * Den DELADE fakturan (#937/#1439): vy-modellen `buildFakturaView` och dess
 * enda renderare, PDF:en (`renderFakturaPdf`). Kontraktet är detsamma för ALLA
 * fakturor (aconto, rådgivning, slutfaktura, kredit): sammanställning på första
 * sidan, specifikation därefter.
 *
 * Kostnadsräkningen till domstol har en egen mall och berörs inte.
 */

import { describe, it, expect } from "vitest-compat";
import { buildFakturaView, fakturaHeading, type FakturaTemplateArgs, type InvoiceSpecification } from "@/lib/client/kostnadsrakning/faktura-template";
import { renderFakturaPdf } from "@/lib/client/kostnadsrakning/render-faktura-pdf";
import { formatCurrency } from "@/lib/client/utils";
import { tidsspillanOvrigFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { buildInvoiceSpecification } from "@/lib/shared/invoice-specification";
import { orgImageSchema } from "@/lib/shared/org-image";
import { asId } from "@/lib/shared/schemas/ids";
import { pdfPageTexts } from "../../../helpers/pdf-text";

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

/** Beloppen som de står i PDF:en (hårda mellanslag → vanliga, som i `pdfPageTexts`). */
const kr = (ore: number): string => formatCurrency(ore).replace(/[  ]/g, " ");

/** Fakturan renderad till PDF → texten per sida, i ritordning. */
async function rendered(args: FakturaTemplateArgs): Promise<string[][]> {
  return pdfPageTexts(await renderFakturaPdf(buildFakturaView(args)));
}

describe("fakturaHeading", () => {
  it("härleds ur fakturatyp — rådgivningstimmen känns igen på notes", () => {
    expect(fakturaHeading({ invoiceType: "FINAL", notes: null })).toBe("Faktura");
    expect(fakturaHeading({ invoiceType: "ACCONTO", notes: null })).toBe("Aconto-faktura");
    expect(fakturaHeading({ invoiceType: "CREDIT", notes: null })).toBe("Kreditfaktura");
    expect(fakturaHeading({ invoiceType: "STANDARD", notes: "Rådgivningstimme enligt rättshjälpstaxan (1 tim)." }))
      .toBe("Rådgivningsfaktura");
  });
});

describe("fakturan (PDF) — sammanställning + specifikation (#937/#1439)", () => {
  it("sammanställningen står på sida 1, specifikationen på en egen sida därefter", async () => {
    const pages = await rendered({
      invoice: invoice(), recipient: "Cecilia Carlsson", meta: META,
      spec: spec({
        timeLines: [{ date: "2026-05-02", description: "Genomgång av handlingar", minutes: 60, amountOre: 162_600 }],
        totalMinutes: 60, arvodeNetOre: 162_600, arvodeVatOre: 40_650, grossOre: 203_250, payableOre: 203_250
      }),
    });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("Sammanställning");
    expect(pages[0]).not.toContain("Specifikation");
    expect(pages[1]?.[0]).toBe("Specifikation");
    expect(pages[1]).toContain("Tidsspecifikation");
  });

  it("fakturor utan egna tidsposter specificeras ur nedbrytningens arbete (#880)", async () => {
    // Klientens självrisk-faktura: arbetet ligger på betalar-fakturan, men
    // nedbrytningen bär tidsraderna → specifikationen ska ändå renderas.
    const texts = (await rendered({
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
    })).flat();
    expect(texts).toContain("Tidsspecifikation");
    expect(texts).toContain("Restid till sammanträde");
    // Äldre rader saknar arvodeskategori (#953) → tidsspillan-normerna räddas ur
    // taxan, resten benämns arvode. Här: 1 626 = arvode, 1 487 = tidsspillan dagtid.
    expect(texts).toContain("Timarvode");
    expect(texts).toContain("Tidsspillan");
    expect(texts).toContain(`${kr(148_700)}/tim`);
    // Uppdelningen (klient/betalare) och fakturans faktiska belopp bevaras.
    expect(texts).toContain("Klientens självrisk 20 % (exkl moms)");
    expect(texts).toContain(kr(81_300));
  });

  it("faktura helt utan itemiserat arbete får ändå en förklarande rad ur notes (#870)", async () => {
    const pages = await rendered({
      invoice: invoice({ amount: 203_250, invoiceType: "STANDARD", notes: "Rådgivningstimme enligt rättshjälpstaxan (1 tim)." }),
      recipient: "Cecilia Carlsson", meta: META, spec: spec({ payableOre: 203_250 }),
    });
    const text = pages.flat().join("\n");
    expect(text).toContain("RÅDGIVNINGSFAKTURA");
    expect(text).toContain("Sammanställning");
    expect(text).toContain("Rådgivningstimme enligt rättshjälpstaxan (1 tim).");
    expect(text).toContain(kr(203_250));
    // Rådgivningsnotisen (spegel av KR-notisen) följer med — ordbruten i PDF:en.
    expect(text.replace(/\n/g, " ")).toContain("ingår INTE i kostnadsräkningen till domstolen");
    // Inget tomt specifikations-avsnitt när det inte finns något underlag.
    expect(pages).toHaveLength(1);
  });

  it("utan spec faller fakturan tillbaka på netto/moms ur fakturan", async () => {
    const texts = (await rendered({ invoice: invoice(), recipient: "Klient AB", meta: META })).flat();
    expect(texts).toContain("Netto (exkl moms)");
    expect(texts).toContain(kr(203_250 - 40_650));
    expect(texts).toContain("Att betala (inkl moms)");
  });

  it("sammanställningen BENÄMNER varje arvodeskategori — inte 'Arvode' fyra gånger (#953)", async () => {
    // Efter en retroaktiv taxehöjning bär raden slutregleringsårets taxa men sitt
    // eget datum, så benämningen KAN inte gissas ur beloppet — kategorin måste följa
    // med. Alla fyra kategorierna, var och en på sin 2026-norm.
    const [page1 = []] = await rendered({
      invoice: invoice(), recipient: "Domstol (kostnadsräkning)", meta: META,
      spec: spec({
        timeLines: [
          { date: "2025-11-25", description: "Genomgång av handlingar", minutes: 240, amountOre: 650_400, kind: "ARBETE" },
          { date: "2025-12-29", description: "Jourärende under helg", minutes: 120, amountOre: 651_200, kind: "ARBETE_OBEKVAM_TID" },
          { date: "2025-12-17", description: "Restid till sammanträde", minutes: 180, amountOre: 446_100, kind: "TIDSSPILLAN" },
          { date: "2026-05-16", description: "Hemresa efter kvällssammanträde", minutes: 90, amountOre: 146_250, kind: "TIDSSPILLAN_OVRIG_TID" },
        ],
        totalMinutes: 630, arvodeNetOre: 1_893_950, arvodeVatOre: 473_488, grossOre: 2_367_438, payableOre: 2_367_438
      }),
    });
    for (const label of ["Timarvode", "Timarvode helg/kväll", "Tidsspillan", "Tidsspillan helg/kväll"]) expect(page1).toContain(label);
    // Varje kategori får sin egen taxa-rad, ingen sammanslagning.
    expect(page1).toContain(`${kr(325_600)}/tim`);
    expect(page1).toContain(`${kr(97_500)}/tim`);
    // Ordningen är kategori-ordningen (arvode först, tidsspillan sist), inte taxan —
    // annars hamnar helgtaxan (högst) överst.
    expect(page1.indexOf("Timarvode")).toBeLessThan(page1.indexOf("Tidsspillan"));
    expect(page1.indexOf("Tidsspillan")).toBeLessThan(page1.indexOf("Tidsspillan helg/kväll"));
  });

  it("samma kategori på TVÅ taxor (byråns egen taxa ändrad) ger en rad per taxa", async () => {
    const [page1 = []] = await rendered({
      invoice: invoice(), recipient: "Klient AB", meta: META,
      spec: spec({
        timeLines: [
          { date: "2026-01-10", description: "Arbete före höjning", minutes: 60, amountOre: 250_000, kind: "ARBETE" },
          { date: "2026-06-10", description: "Arbete efter höjning", minutes: 60, amountOre: 280_000, kind: "ARBETE" },
        ],
        totalMinutes: 120, arvodeNetOre: 530_000, arvodeVatOre: 132_500, grossOre: 662_500, payableOre: 662_500
      }),
    });
    expect(page1).toContain(`${kr(250_000)}/tim`);
    expect(page1).toContain(`${kr(280_000)}/tim`);
  });

  it("organisationsuppgifter står i sidhuvudet när de finns", async () => {
    const texts = (await rendered({
      invoice: invoice(), recipient: "Klient AB",
      meta: { ...META, organizationName: "Firma AB", organizationOrgNumber: "556677-8899" },
    })).flat();
    expect(texts).toContain("Firma AB");
    expect(texts).toContain("Org.nr 556677-8899");
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
  const base = buildInvoiceSpecification({ timeLines, expenseLines, deductions, payableOre: 0, rounding: "KRONOR" });
  return buildInvoiceSpecification({ timeLines, expenseLines, deductions, payableOre: base.grossOre - 200_000, rounding: "KRONOR" });
}

describe("buildFakturaView — sammanställningen är en uträkning (#1200)", () => {
  const s = realisticSpec();
  const v = buildFakturaView({ invoice: invoice({ amount: s.payableOre }), recipient: "Klient AB", meta: META, spec: s }, ore);

  it("arvoderaderna läses som tim × timpris = belopp, arvode före tidsspillan", () => {
    expect(v.summary.slice(0, 2)).toEqual([
      { label: "Timarvode", hours: "3,5", rateLabel: "150000/tim", amount: "525000", subtotal: false },
      { label: "Tidsspillan", hours: "1,5", rateLabel: "100000/tim", amount: "150000", subtotal: false },
    ]);
  });

  it("kedjan: summa arvode → moms → utlägg → moms → äkta utlägg → summa inkl moms", () => {
    expect(v.summary.map((r) => r.label)).toEqual([
      // Kategorin heter "Timarvode" — inte "Arvode" bredvid "Summa arvode exkl moms" (#1206).
      "Timarvode", "Tidsspillan",
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

  it("tidsspecifikationen delas per kategori med delsumma — inget timpris per post (#1439)", () => {
    expect(v.timeGroups.map((g) => [g.label, g.subtotalLabel, g.hours, g.amount])).toEqual([
      ["Timarvode", "Summa timarvode", "3,5", "525000"],
      ["Tidsspillan", "Summa tidsspillan", "1,5", "150000"],
    ]);
    expect(v.timeGroups[0]?.lines.map((l) => [l.date, l.description, l.hours, l.amount])).toEqual([
      ["2026-05-02", "Genomgång av handlingar", "2,5", "375000"],
      ["2026-05-04", "Huvudförhandling", "1", "150000"],
    ]);
    expect(v.timeGroups[0]?.lines[0]).not.toHaveProperty("rate");
    // Delsummorna = posterna i deltabellen, och tillsammans = summa arvode exkl moms.
    for (const g of v.timeGroups) expect(g.lines.reduce((acc, l) => acc + Number(l.amount), 0)).toBe(Number(g.amount));
    expect(v.timeGroups.reduce((acc, g) => acc + Number(g.amount), 0)).toBe(s.arvodeNetOre);
    // Den platta listan (#852) bär posterna i fakturans ordning.
    expect(v.timeLines.map((l) => l.description)).toEqual(["Genomgång av handlingar", "Restid till tingsrätten", "Huvudförhandling"]);
  });
});

describe("buildFakturaView — kantfall i uträkningen (#1200)", () => {
  it("nollrader utelämnas (inga utlägg → ingen utläggs-/utläggsmomsrad)", () => {
    const s = buildInvoiceSpecification({
      timeLines: [{ date: "2026-05-02", description: "Möte", minutes: 60, amountOre: 150_000, kind: "ARBETE" }],
      expenseLines: [], deductions: [], payableOre: 187_500, rounding: "KRONOR"
    });
    const v = buildFakturaView({ invoice: invoice({ amount: 187_500 }), recipient: "K", meta: META, spec: s }, ore);
    expect(v.summary.map((r) => r.label)).toEqual(["Timarvode", "Summa arvode exkl moms", "Moms 25 % på arvode"]);
    expect(reconcile(v.summary)).toBe(187_500);
    expect(v.hasSplit).toBe(false);
  });

  it("per-dygns-kategorier visas som dygn × dagbelopp, inte som timpris", () => {
    const s = buildInvoiceSpecification({
      timeLines: [
        { date: "2026-05-02", description: "Beredskap lördag", minutes: 0, amountOre: 250_000, kind: "ADVOKATBEREDSKAP" },
        { date: "2026-05-03", description: "Beredskap söndag", minutes: 0, amountOre: 250_000, kind: "ADVOKATBEREDSKAP" },
      ],
      expenseLines: [], deductions: [], payableOre: 625_000, rounding: "KRONOR"
    });
    const v = buildFakturaView({ invoice: invoice({ amount: 625_000 }), recipient: "K", meta: META, spec: s }, ore);
    expect(v.summary[0]).toEqual({ label: "Advokatberedskap — garantiersättning per dag", hours: "2 dygn", rateLabel: "250000/dygn", amount: "500000", subtotal: false });
    expect(v.timeGroups[0]?.hours).toBe("2 dygn");
    expect(v.timeGroups[0]?.lines[0]).toEqual({ date: "2026-05-02", description: "Beredskap lördag", hours: "1 dygn", amount: "250000" });
    expect(reconcile(v.summary)).toBe(Number(v.summaryTotal));
  });

  it("post utan tid och belopp får inget påhittat timpris", () => {
    const s = buildInvoiceSpecification({
      timeLines: [{ date: "2026-05-02", description: "Notering", minutes: 0, amountOre: 0, kind: "ARBETE" }],
      expenseLines: [], deductions: [], payableOre: 0, rounding: "KRONOR"
    });
    const v = buildFakturaView({ invoice: invoice({ amount: 0 }), recipient: "K", meta: META, spec: s }, ore);
    expect(v.summary[0]?.rateLabel).toBe("");
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
        expenseLines: [], deductions: [], payableOre: 0, rounding: "KRONOR"
      }),
    }, ore);
    expect(v.timeGroups.map((g) => g.label)).toEqual(["Timarvode", "Tidsspillan helg/kväll"]);
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

describe("fakturan (PDF) — kolumner och deltabeller (#1200/#1439)", () => {
  const pagesP = rendered({ invoice: invoice(), recipient: "Klient AB", meta: META, spec: realisticSpec() });

  it("sammanställningen har kolumnerna Benämning | Tim | Timpris | Belopp och summaraderna", async () => {
    const [page1 = []] = await pagesP;
    const head = page1.indexOf("Benämning");
    expect(page1.slice(head, head + 4)).toEqual(["Benämning", "Tim", "Timpris", "Belopp"]);
    expect(page1).toContain("Summa arvode exkl moms");
    expect(page1).toContain("Summa inkl moms");
    expect(page1).not.toContain("Timtaxa");
  });

  it("tidsspecifikationen: en deltabell per kategori med delsumma — utan timpris per post (#1439)", async () => {
    const [, page2 = []] = await pagesP;
    expect(page2.indexOf("Timarvode")).toBeLessThan(page2.indexOf("Tidsspillan"));
    expect(page2).toContain("Summa tidsspillan");
    // Kolumnerna är Datum | Beskrivning | Tim | Belopp — timpriset står bara i sammanställningen.
    const head = page2.indexOf("Datum");
    expect(page2.slice(head, head + 4)).toEqual(["Datum", "Beskrivning", "Tim", "Belopp"]);
    expect(page2).not.toContain("Timpris");
    expect(page2.some((t) => t.endsWith("/tim"))).toBe(false);
    // Posten: hela datumet, omfattning och belopp på första raden, sedan beskrivningen.
    const row = page2.indexOf("2026-05-02");
    expect(page2.slice(row, row + 4)).toEqual(["2026-05-02", "2,5", kr(375_000), "Genomgång av handlingar"]);
  });
});

describe("fakturan — byråns logga (#1439)", () => {
  /** 1×1 px PNG — minsta giltiga bild. */
  const PNG = orgImageSchema.parse("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

  it("vy-modellen bär loggan ur organisationsinställningarna; utan logga → null", () => {
    expect(buildFakturaView({ invoice: invoice(), recipient: "K", meta: { ...META, organizationLogo: PNG } }).logo).toBe(PNG);
    expect(buildFakturaView({ invoice: invoice(), recipient: "K", meta: META }).logo).toBeNull();
  });
});
