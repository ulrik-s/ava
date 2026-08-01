/**
 * `renderFakturaPdf` (#938) — bilagan vid manuellt fakturautskick. Samma upplägg
 * som det arkiverade HTML-dokumentet: sammanställning på sida 1, specifikation
 * på egen sida därefter. Renderaren tar en färdig `FakturaView` och räknar inget.
 */
import { describe, it, expect } from "vitest-compat";
import { buildFakturaView, type FakturaView } from "@/lib/client/kostnadsrakning/faktura-template";
import { renderFakturaPdf, toWinAnsi } from "@/lib/client/kostnadsrakning/render-faktura-pdf";
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
  summary: [{ label: "Arvode (timkostnadsnorm)", rateLabel: "1 626,00 kr/tim", hours: "4", amount: "6 504,00 kr" }],
  summaryTotal: "8 130,00 kr",
  hasSplit: false, splitRows: [{ label: "Netto (exkl moms)", amount: "6 504,00 kr", style: "", muted: false }],
  totalLabel: "Att betala (inkl moms)", total: "8 130,00 kr",
  hasSpec: false, timeLines: [], expenseLines: [], ...over,
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
      timeLines: [{ date: "2026-05-02", description: "Genomgång av handlingar", hours: "4", amount: "6 504,00 kr" }],
      expenseLines: [{ date: "2026-05-03", description: "Ansökningsavgift", net: "900,00 kr", gross: "1 125,00 kr" }],
    }));
    expect(await pageCount(bytes)).toBe(2);
  });

  it("bryter sidan när tidsspecifikationen är längre än en sida", async () => {
    const timeLines = Array.from({ length: 120 }, (_, i) => ({
      date: "2026-05-02", description: `Post ${i} — genomgång av handlingar och underlag`,
      hours: "1", amount: "1 626,00 kr",
    }));
    const bytes = await renderFakturaPdf(view({ hasSpec: true, timeLines }));
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
