/**
 * `renderFakturaPdf` (#938/#1439) — fakturans enda format: både det arkiverade
 * dokumentet och bilagan vid utskick. Sammanställning på sida 1, specifikation
 * på egen sida därefter. Renderaren tar en färdig `FakturaView` och räknar inget.
 */
import { inflateSync } from "node:zlib";
import { describe, it, expect } from "vitest-compat";
import { buildFakturaView, type FakturaView } from "@/lib/client/kostnadsrakning/faktura-template";
import { renderFakturaPdf, toWinAnsi } from "@/lib/client/kostnadsrakning/render-faktura-pdf";
import { buildInvoiceSpecification } from "@/lib/shared/invoice-specification";
import { orgImageSchema } from "@/lib/shared/org-image";
import { asId } from "@/lib/shared/schemas/ids";
import { pdfPageContents, pdfPageLayouts, pdfPageTexts, type PdfLineItem, type PdfTextItem } from "../../../helpers/pdf-text";

const head = (b: Uint8Array) => String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!);

async function pageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  return (await PDFDocument.load(bytes)).getPageCount();
}

const view = (over: Partial<FakturaView> = {}): FakturaView => ({
  heading: "Faktura", invoiceNumber: "F-2026-0001", ocr: "1234567894", date: "2026-05-12",
  matterNumber: "B 2026-1234", matterTitle: "Brottmål Falk", recipient: "Domstolsverket",
  organizationName: "Firma AB", organizationOrgNumber: "556677-8899", logo: null, footnote: "",
  summary: [{ label: "Arvode (timkostnadsnorm)", rateLabel: "1 626,00 kr/tim", hours: "4", amount: "6 504,00 kr", subtotal: false }],
  summaryTotalLabel: "Summa inkl moms", summaryTotal: "8 130,00 kr",
  hasSplit: false, splitRows: [{ label: "Netto (exkl moms)", amount: "6 504,00 kr", style: "", muted: false }],
  totalLabel: "Att betala (inkl moms)", total: "8 130,00 kr",
  hasSpec: false, timeLines: [], timeGroups: [], expenseLines: [], expenseNetTotal: "", expenseGrossTotal: "", ...over,
});

describe("toWinAnsi", () => {
  it("ersätter tecken som pdf-lib:s WinAnsi inte kan koda", () => {
    // U+2212 MINUS SIGN används i avdragsrader — pdf-lib KASTAR på den.
    expect(toWinAnsi("−1 000,00 kr")).toBe("-1 000,00 kr");
    expect(toWinAnsi("…")).toBe("...");
    expect(toWinAnsi("”citat”")).toBe('"citat"');
    // Svenska tecken ligger i Latin-1 och ska överleva orörda.
    expect(toWinAnsi("Utlägg för rättshjälp — å ä ö")).toBe("Utlägg för rättshjälp - å ä ö");
  });
});

describe("renderFakturaPdf", () => {
  it("producerar en giltig PDF på en sida när det saknas underlag", async () => {
    const bytes = await renderFakturaPdf(view());
    expect(head(bytes)).toBe("%PDF");
    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(await pageCount(bytes)).toBe(1);
  });

  it("specifikationen får en EGEN sida efter sammanställningen", async () => {
    const bytes = await renderFakturaPdf(view({
      hasSpec: true,
      timeGroups: [{
        label: "Arvode", subtotalLabel: "Summa arvode", hours: "4", amount: "6 504,00 kr",
        lines: [{ date: "2026-05-02", description: "Genomgång av handlingar", hours: "4", amount: "6 504,00 kr" }],
      }],
      expenseLines: [{ date: "2026-05-03", description: "Ansökningsavgift", net: "900,00 kr", gross: "1 125,00 kr" }],
    }));
    expect(await pageCount(bytes)).toBe(2);
  });

  it("bryter sidan när tidsspecifikationen är längre än en sida", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({
      date: "2026-05-02", description: `Post ${i} — genomgång av handlingar och underlag`,
      hours: "1", amount: "1 626,00 kr",
    }));
    const timeGroups = [{ label: "Arvode", subtotalLabel: "Summa arvode", hours: "120", amount: "195 120,00 kr", lines }];
    const bytes = await renderFakturaPdf(view({ hasSpec: true, timeGroups }));
    expect(await pageCount(bytes)).toBeGreaterThan(2);
  });

  it("avdragsrader (−) och rådgivningsnotisen kraschar inte renderaren", async () => {
    const bytes = await renderFakturaPdf(view({
      hasSplit: true,
      splitRows: [
        { label: "Upparbetat arvode (exkl moms)", amount: "6 504,00 kr", style: "", muted: false },
        { label: "Avgår aconto — faktura F-2026-0000 (2026-04-01)", amount: "−1 000,00 kr", style: "color:#b45309", muted: true },
        { label: "Betalt via aconto", amount: "(500,00 kr)", style: "color:#9ca3af", muted: true },
      ],
      footnote: "Rådgivningstimmen (1 tim enligt rättshjälpstaxan) faktureras klienten separat och ingår INTE i kostnadsräkningen till domstolen.",
    }));
    expect(head(bytes)).toBe("%PDF");
  });

  it("renderar vy-modellen som byggs av buildFakturaView (samma källa som HTML:en)", async () => {
    const v = buildFakturaView({
      invoice: { id: asId<"InvoiceId">("inv-1"), amount: 203_250, vatOre: 40_650, invoiceNumber: "F-2026-0007", invoiceDate: "2026-06-30" },
      recipient: "Cecilia Carlsson",
      meta: { matterNumber: "2026-0010", matterTitle: "Umgängestvist Carlsson" },
      spec: {
        timeLines: [{ date: "2026-05-02", description: "Genomgång av handlingar", minutes: 60, amountOre: 162_600 }],
        expenseLines: [], totalMinutes: 60,
        arvodeNetOre: 162_600, arvodeVatOre: 40_650, expensesNetOre: 0, expensesVatOre: 0,
        grossOre: 203_250, deductions: [], deductionOre: 0, adjustmentOre: 0, payableOre: 203_250,
      },
    });
    expect(v.hasSpec).toBe(true);
    const bytes = await renderFakturaPdf(v);
    expect(head(bytes)).toBe("%PDF");
    expect(await pageCount(bytes)).toBe(2);
  });
});

/** Alla textsträngar som ritats i PDF:en (innehållsströmmarna packas upp, pdf-lib
 *  skriver StandardFont-text som `<hex> Tj`). Ritordning inom varje sida. */
function pdfTexts(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString("latin1");
  const texts: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = "";
    try { body = inflateSync(Buffer.from(m[1] ?? "", "latin1")).toString("latin1"); } catch { /* inte en flate-ström */ }
    for (const t of body.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) texts.push(Buffer.from(t[1] ?? "", "hex").toString("latin1"));
  }
  return texts;
}

describe("renderFakturaPdf — uträkningen och deltabellerna (#1200/#1439)", () => {
  const v = buildFakturaView({
    invoice: { id: asId<"InvoiceId">("inv-2"), amount: 1_046_875, invoiceNumber: "F-2026-0008", invoiceDate: "2026-06-30" },
    recipient: "Klient AB",
    meta: { matterNumber: "2026-0011", matterTitle: "Tvist" },
    spec: buildInvoiceSpecification({
      timeLines: [
        { date: "2026-05-02", description: "Genomgång av handlingar", minutes: 150, amountOre: 375_000, kind: "ARBETE" },
        { date: "2026-05-04", description: "Restid till tingsrätten", minutes: 90, amountOre: 150_000, kind: "TIDSSPILLAN" },
      ],
      expenseLines: [{ date: "2026-05-04", description: "Tågbiljett", netOre: 90_000, grossOre: 112_500 }],
      deductions: [], payableOre: 768_750, rounding: "KRONOR"
    }),
  });

  it("sammanställningen: Tim | Timpris-kolumner, kedjan och slutsumman", async () => {
    const texts = pdfTexts(await renderFakturaPdf(v));
    const at = (s: string) => texts.indexOf(s);
    expect(at("Timpris")).toBeGreaterThan(-1);
    expect(texts).not.toContain("Timtaxa");
    for (const label of ["Summa arvode exkl moms", "Moms 25 % på arvode", "Utlägg exkl moms", "Moms 25 % på utlägg", "Summa inkl moms"]) {
      expect(at(label)).toBeGreaterThan(-1);
    }
    expect(at("Summa arvode exkl moms")).toBeLessThan(at("Moms 25 % på arvode"));
    expect(at("Moms 25 % på utlägg")).toBeLessThan(at("Summa inkl moms"));
    expect(texts).toContain(toWinAnsi(v.summaryTotal));
  });

  it("tidsspecifikationen: en deltabell per kategori med delsumma — timpriset bara i sammanställningen (#1439)", async () => {
    const texts = pdfTexts(await renderFakturaPdf(v));
    const at = (s: string) => texts.indexOf(s);
    // Kategorirubriken står både i sammanställningen och som deltabellens rubrik
    // (sista förekomsten) — efter arvodets delsumma.
    expect(texts.lastIndexOf("Tidsspillan")).toBeGreaterThan(at("Summa timarvode"));
    expect(at("Summa timarvode")).toBeGreaterThan(-1);
    expect(at("Summa tidsspillan")).toBeGreaterThan(-1);
    // "Timpris" och "…/tim" står en gång per kategori — i sammanställningen, före specifikationen.
    const spec = at("Specifikation");
    expect(texts.lastIndexOf("Timpris")).toBeLessThan(spec);
    expect(texts.slice(spec).some((t) => t.endsWith("/tim"))).toBe(false);
  });
});

/** 1×1 px PNG — minsta giltiga byråbild. */
const PNG_LOGO = orgImageSchema.parse("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

describe("renderFakturaPdf — byråns logga (#1439)", () => {
  /** Ritas en bild (`Do`-operatorn) på sidan? */
  const drawsImage = (content: string | undefined): boolean => /\/\S+ Do/.test(content ?? "");

  it("loggan ritas i sidhuvudet på sida 1, men inte på specifikationens sidor", async () => {
    const lines = [{ date: "2026-05-02", description: "Genomgång", hours: "1", amount: "1 626,00 kr" }];
    const timeGroups = [{ label: "Arvode", subtotalLabel: "Summa arvode", hours: "1", amount: "1 626,00 kr", lines }];
    const [page1, page2] = await pdfPageContents(await renderFakturaPdf(view({ logo: PNG_LOGO, hasSpec: true, timeGroups })));
    expect(drawsImage(page1)).toBe(true);
    expect(drawsImage(page2)).toBe(false);
  });

  it("utan logga är layouten oförändrad — ingen bild, samma text på samma plats", async () => {
    const without = await renderFakturaPdf(view());
    const [page] = await pdfPageContents(without);
    expect(drawsImage(page)).toBe(false);
    const withLogo = await renderFakturaPdf(view({ logo: PNG_LOGO }));
    // Texten (och dess ordning) är densamma med och utan logga — loggan ritas i en egen ruta.
    expect(await pdfPageTexts(withLogo)).toEqual(await pdfPageTexts(without));
  });

  it("en logga som inte går att bädda in fäller inte fakturan — den ritas utan logga", async () => {
    // Giltig data-URL enligt schemat, men inte en riktig PNG.
    const broken = orgImageSchema.parse("data:image/png;base64,AAAA");
    const bytes = await renderFakturaPdf(view({ logo: broken }));
    expect(head(bytes)).toBe("%PDF");
    const [page] = await pdfPageContents(bytes);
    expect(drawsImage(page)).toBe(false);
  });
});

describe("renderFakturaPdf — specifikationens rader (#1439)", () => {
  const group = (description: string) => [{
    label: "Arvode", subtotalLabel: "Summa arvode", hours: "1", amount: "1 626,00 kr",
    lines: [{ date: "2026-10-03", description, hours: "1", amount: "1 626,00 kr" }],
  }];

  it("datumet ritas helt på en rad och en lång beskrivning radbryts i stället för att kapas", async () => {
    const long = "Genomgång av förundersökningsprotokollet med samtliga bilagor, förhörsutskrifter och tekniska utredningar inför huvudförhandlingen";
    const [, page2 = []] = await pdfPageTexts(await renderFakturaPdf(view({ hasSpec: true, timeGroups: group(long) })));
    const row = page2.indexOf("2026-10-03");
    expect(row).toBeGreaterThan(-1);
    // Datum, Tim och Belopp på första raden; därefter beskrivningen över flera rader.
    expect(page2.slice(row, row + 3)).toEqual(["2026-10-03", "1", "1 626,00 kr"]);
    const descLines = page2.slice(row + 3, page2.indexOf("Summa arvode"));
    expect(descLines.length).toBeGreaterThan(1);
    expect(descLines.join(" ")).toBe(long);
    expect(page2.some((t) => t.endsWith("..."))).toBe(false);
  });

  it("en post utan beskrivning tar ändå sin rad", async () => {
    const [, page2 = []] = await pdfPageTexts(await renderFakturaPdf(view({ hasSpec: true, timeGroups: group("") })));
    expect(page2).toContain("2026-10-03");
    expect(page2).toContain("Summa arvode");
  });
});

describe("renderFakturaPdf — summarader i specifikationen (#1506)", () => {
  const expense = (i: number) => ({ date: "2026-05-03", description: `Utlägg ${i}`, net: "900,00 kr", gross: "1 125,00 kr" });
  const withExpenses = (n: number) => view({
    hasSpec: true, expenseLines: Array.from({ length: n }, (_, i) => expense(i)),
    expenseNetTotal: "1 800,00 kr", expenseGrossTotal: "2 250,00 kr",
  });
  const timeGroups = [{
    label: "Arvode", subtotalLabel: "Summa arvode", hours: "2", amount: "3 252,00 kr",
    lines: [{ date: "2026-05-02", description: "Genomgång", hours: "2", amount: "3 252,00 kr" }],
  }];

  /** Högerkanten (pt) för en fet körning. */
  async function rightEdge(run: PdfTextItem | undefined): Promise<number> {
    if (!run) return Number.NaN;
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const bold = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold);
    return run.x + bold.widthOfTextAtSize(run.text, run.size);
  }
  const find = (runs: readonly PdfTextItem[], text: string): PdfTextItem | undefined => runs.find((r) => r.text === text);
  const isBold = (run: PdfTextItem | undefined): boolean => run?.font.includes("Bold") ?? false;
  /** Strecket närmast ovanför baslinjen `y` (fakturan ritar bara vågräta streck). */
  const ruleAbove = (lines: readonly PdfLineItem[], y: number): PdfLineItem | undefined =>
    lines.filter((l) => l.y > y).sort((a, b) => a.y - b.y)[0];

  it("utläggsspecifikationen avslutas med en fet summarad i Netto- och Brutto-kolumnerna", async () => {
    const bytes = await renderFakturaPdf(withExpenses(2));
    const [, { texts: runs } = { texts: [] }] = await pdfPageLayouts(bytes);
    const label = find(runs, "Summa utlägg");
    const net = find(runs, "1 800,00 kr");
    const gross = find(runs, "2 250,00 kr");
    expect(isBold(label)).toBe(true);
    expect(isBold(net) && isBold(gross)).toBe(true);
    expect(net?.y).toBe(label?.y);
    expect(gross?.y).toBe(label?.y);
    // Exakt samma högerkant som kolumnrubrikerna (Netto 470, Brutto 545).
    expect(await rightEdge(net)).toBeCloseTo(470, 3);
    expect(await rightEdge(gross)).toBeCloseTo(545, 3);
    const headNet = find(runs, "Netto");
    expect(await rightEdge(headNet)).toBeCloseTo(470, 3);
  });

  it("ett tunt streck med tydlig luft står mellan sista utlägget och summaraden", async () => {
    const bytes = await renderFakturaPdf(withExpenses(2));
    const [, { texts: runs, lines } = { texts: [], lines: [] }] = await pdfPageLayouts(bytes);
    const last = find(runs, "Utlägg 1");
    const label = find(runs, "Summa utlägg");
    const rule = ruleAbove(lines, label?.y ?? 0);
    expect(rule).toBeDefined();
    expect(rule?.y).toBeLessThan(last?.y ?? 0);
    // Strecket står minst 16 pt under sista postens baslinje (tidigare 10).
    expect((last?.y ?? 0) - (rule?.y ?? 0)).toBeGreaterThanOrEqual(16);
  });

  it("tidsspecifikationen: mer luft mellan sista posten och strecket före delsumman", async () => {
    const bytes = await renderFakturaPdf(view({ hasSpec: true, timeGroups }));
    const [, { texts: runs, lines } = { texts: [], lines: [] }] = await pdfPageLayouts(bytes);
    const last = find(runs, "Genomgång");
    const subtotal = find(runs, "Summa arvode");
    const rule = ruleAbove(lines, subtotal?.y ?? 0);
    expect((last?.y ?? 0) - (rule?.y ?? 0)).toBeGreaterThanOrEqual(16);
    // Delsumman: fet, i Tim/Belopp-kolumnerna (oförändrat).
    expect(isBold(subtotal)).toBe(true);
    const amounts = runs.filter((r) => r.text === "3 252,00 kr" && isBold(r));
    expect(amounts).toHaveLength(1);
    expect(await rightEdge(amounts[0])).toBeCloseTo(545, 3);
  });

  it("utan utlägg ritas ingen utläggssummarad", async () => {
    const texts = (await pdfPageTexts(await renderFakturaPdf(view({ hasSpec: true, timeGroups })))).flat();
    expect(texts).toContain("Summa arvode");
    expect(texts).not.toContain("Summa utlägg");
  });

  /** Sidans nedre marginal i mallen (`BOTTOM` i render-faktura-pdf.ts). */
  const PAGE_BOTTOM_MARGIN = 64;

  it("streck och summarad hålls ihop vid sidbrytning", async () => {
    // Prova många längder så att sista posten hamnar på varje tänkbar plats nära sidans fot.
    for (let n = 40; n <= 70; n++) {
      const bytes = await renderFakturaPdf(withExpenses(n));
      const pages = await pdfPageLayouts(bytes);
      const page = pages.find((p) => find(p.texts, "Summa utlägg"));
      const label = find(page?.texts ?? [], "Summa utlägg");
      const rule = ruleAbove(page?.lines ?? [], label?.y ?? 0);
      expect(rule).toBeDefined();
      expect((rule?.y ?? 0) - (label?.y ?? 0)).toBeLessThan(15);
      // Summaraden (och därmed strecket ovanför) får inte hamna under sidans nedre marginal.
      expect(label?.y ?? 0).toBeGreaterThanOrEqual(PAGE_BOTTOM_MARGIN);
    }
  });
});
