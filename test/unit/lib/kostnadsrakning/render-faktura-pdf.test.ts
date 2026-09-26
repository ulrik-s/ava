/**
 * `renderFakturaPdf` (#938) — bilagan vid manuellt fakturautskick. Samma upplägg
 * som det arkiverade HTML-dokumentet: sammanställning på sida 1, specifikation
 * på egen sida därefter. Renderaren tar en färdig `FakturaView` och räknar inget.
 */
import { inflateSync } from "node:zlib";
import { describe, it, expect } from "vitest-compat";
import { buildFakturaView, type FakturaView } from "@/lib/client/kostnadsrakning/faktura-template";
import { renderFakturaPdf, toWinAnsi } from "@/lib/client/kostnadsrakning/render-faktura-pdf";
import { buildInvoiceSpecification } from "@/lib/shared/invoice-specification";
import { asId } from "@/lib/shared/schemas/ids";

const head = (b: Uint8Array) => String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!);

async function pageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  return (await PDFDocument.load(bytes)).getPageCount();
}

const view = (over: Partial<FakturaView> = {}): FakturaView => ({
  heading: "Faktura", invoiceNumber: "F-2026-0001", ocr: "1234567894", date: "2026-05-12",
  matterNumber: "B 2026-1234", matterTitle: "Brottmål Falk", recipient: "Domstolsverket",
  organizationName: "Firma AB", organizationOrgNumber: "556677-8899", footnote: "",
  summary: [{ label: "Arvode (timkostnadsnorm)", rateLabel: "1 626,00 kr/tim", hours: "4", amount: "6 504,00 kr", subtotal: false }],
  summaryTotalLabel: "Summa inkl moms", summaryTotal: "8 130,00 kr",
  hasSplit: false, splitRows: [{ label: "Netto (exkl moms)", amount: "6 504,00 kr", style: "", muted: false }],
  totalLabel: "Att betala (inkl moms)", total: "8 130,00 kr",
  hasSpec: false, timeLines: [], timeGroups: [], expenseLines: [], ...over,
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
        lines: [{ date: "2026-05-02", description: "Genomgång av handlingar", hours: "4", rate: "1 626,00 kr/tim", amount: "6 504,00 kr" }],
      }],
      expenseLines: [{ date: "2026-05-03", description: "Ansökningsavgift", net: "900,00 kr", gross: "1 125,00 kr" }],
    }));
    expect(await pageCount(bytes)).toBe(2);
  });

  it("bryter sidan när tidsspecifikationen är längre än en sida", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({
      date: "2026-05-02", description: `Post ${i} — genomgång av handlingar och underlag`,
      hours: "1", rate: "1 626,00 kr/tim", amount: "1 626,00 kr",
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

describe("renderFakturaPdf — samma uträkning och deltabeller som HTML:en (#1200)", () => {
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
      deductions: [], payableOre: 768_750,
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

  it("tidsspecifikationen: en deltabell per kategori med timpris och delsumma", async () => {
    const texts = pdfTexts(await renderFakturaPdf(v));
    const at = (s: string) => texts.indexOf(s);
    // Kategorirubriken står både i sammanställningen och som deltabellens rubrik
    // (sista förekomsten) — efter arvodets delsumma.
    expect(texts.lastIndexOf(toWinAnsi("Tidsspillan — vardag 08–18"))).toBeGreaterThan(at("Summa arvode"));
    expect(at("Summa arvode")).toBeGreaterThan(-1);
    expect(at(toWinAnsi("Summa tidsspillan — vardag 08–18"))).toBeGreaterThan(-1);
    expect(texts).toContain(toWinAnsi(v.timeGroups[0]?.lines[0]?.rate ?? "saknas"));
  });
});
