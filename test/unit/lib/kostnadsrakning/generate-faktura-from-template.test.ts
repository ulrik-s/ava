/**
 * Tester för generateFakturaFromTemplate (#852/#1439) — faktura-dokumentet är en
 * PDF: registrerar documentType=Faktura + invoiceId och renderar
 * fakturanummer/mottagare/belopp i PDF:en. Inga nya HTML-dokument.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { generateFakturaFromTemplate } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { formatCurrency } from "@/lib/client/utils";
import { asId } from "@/lib/shared/schemas/ids";
import { isUuid } from "@/lib/shared/uuid";
import { pdfPageTexts } from "../../../helpers/pdf-text";

const persistGeneratedDoc = vi.fn(async () => {});
vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc }));

const registerMutateAsync = vi.fn(async (_input: { id: string }) => {});
const utils = {
  document: {
    tree: { invalidate: vi.fn(async () => {}), refetch: vi.fn(async () => {}) },
    list: { invalidate: vi.fn(async () => {}) },
  },
};

beforeEach(() => { vi.clearAllMocks(); });

/** Belopp som de står i PDF:en (hårda mellanslag → vanliga, som i `pdfPageTexts`). */
const kr = (ore: number): string => formatCurrency(ore).replace(/[\u00A0\u202F]/g, " ");

/** Texten i det persisterade dokumentet (alla sidor, en ritad sträng per rad). */
async function persistedText(): Promise<string> {
  const bytes = persistGeneratedDoc.mock.calls[0]![0].bytes as Uint8Array;
  return (await pdfPageTexts(bytes)).flat().join("\n");
}

describe("generateFakturaFromTemplate", () => {
  it("registrerar Faktura-dokument som PDF kopplat till invoiceId + renderar fakturans data (#1439)", async () => {
    await generateFakturaFromTemplate({
      invoice: { id: asId<"InvoiceId">("inv-9"), amount: 203_250, vatOre: 40_650, invoiceNumber: "F-2026-0099", invoiceDate: "2026-06-30" },
      matterId: asId<"MatterId">("m1"),
      recipient: "Staten",
      meta: { matterNumber: "Ä-1", matterTitle: "Vårdnadstvist", organizationName: "Byrå AB" },
      register: { mutateAsync: registerMutateAsync },
      utils,
    });
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      matterId: "m1", documentType: "Faktura", invoiceId: "inv-9", mimeType: "application/pdf",
    }));
    expect(persistGeneratedDoc).toHaveBeenCalled();
    // uuid-id: servern lagrar bara uuid-nycklade rader (#1143, missades i #1124).
    const registered = registerMutateAsync.mock.calls[0]![0];
    expect(isUuid(registered.id)).toBe(true);
    expect(persistGeneratedDoc.mock.calls[0]![0].id).toBe(registered.id);
    // Inget nytt HTML-dokument (#1439): filnamn, sökväg, typ och bytes är PDF.
    const persisted = persistGeneratedDoc.mock.calls[0]![0] as { storagePath: string; fileName: string; mimeType: string; bytes: Uint8Array };
    expect(persisted.mimeType).toBe("application/pdf");
    expect(persisted.storagePath).toMatch(/^documents\/content\/[0-9a-f-]+\.pdf$/);
    expect(persisted.fileName).toMatch(/^Faktura F-2026-0099 \d{4}-\d{2}-\d{2}\.pdf$/);
    expect(new TextDecoder().decode(persisted.bytes.slice(0, 5))).toBe("%PDF-");
    const text = await persistedText();
    expect(text).toContain("F-2026-0099"); // fakturanummer
    expect(text).toContain("Staten");      // mottagare
    expect(text).toContain("Vårdnadstvist");
  });

  it("renderar fullständig specifikation (tider, utlägg, avdragna aconton) — #856", async () => {
    await generateFakturaFromTemplate({
      invoice: { id: asId<"InvoiceId">("inv-1"), amount: 373_750, vatOre: 93_750, invoiceNumber: "F-2026-0001", invoiceDate: "2026-06-30" },
      matterId: asId<"MatterId">("m1"),
      recipient: "Klient AB",
      meta: { matterNumber: "Ä-1", matterTitle: "Tvist" },
      register: { mutateAsync: registerMutateAsync },
      utils,
      spec: {
        timeLines: [{ date: "2026-05-02", description: "Genomgång av handlingar", minutes: 90, amountOre: 375_000 }],
        expenseLines: [{ date: "2026-05-03", description: "Ansökningsavgift", netOre: 5_000, grossOre: 5_000 }],
        totalMinutes: 90,
        arvodeNetOre: 375_000, arvodeVatOre: 93_750,
        expensesNetOre: 5_000, expensesVatOre: 0,
        grossOre: 473_750,
        deductions: [{ invoiceNumber: "F-2026-0000", date: "2026-04-01", amountOre: 100_000 }],
        deductionOre: 100_000,
        adjustmentOre: 0,
        payableOre: 373_750,
      },
    });
    const text = await persistedText();
    expect(text).toContain("Tidsspecifikation");
    expect(text).toContain("Genomgång av handlingar");
    expect(text).toContain("Utläggsspecifikation");
    expect(text).toContain("Ansökningsavgift");
    expect(text).toContain("Avgår aconto");
    expect(text).toContain("F-2026-0000"); // avdragen aconto-faktura listad i specifikationen
  });

  it("renderar itemiserad nedbrytning (självrisk/rådgivning/prutning + aconto-info) — #858", async () => {
    await generateFakturaFromTemplate({
      invoice: { id: asId<"InvoiceId">("inv-d"), amount: 325_200, vatOre: 65_040, invoiceNumber: "F-2026-0002", invoiceDate: "2026-06-30" },
      matterId: asId<"MatterId">("m1"),
      recipient: "Domstolen",
      meta: { matterNumber: "Ä-1", matterTitle: "Tvist" },
      register: { mutateAsync: registerMutateAsync },
      utils,
      breakdown: {
        rows: [
          { label: "Arvode (timkostnadsnorm)", amountOre: 406_500, kind: "add" },
          { label: "Klientens självrisk", amountOre: 81_300, kind: "deduct" },
          { label: "Betalt via aconto — faktura F-2026-0001 (2026-04-01)", amountOre: 50_000, kind: "info" },
        ],
        totalLabel: "Domstolen betalar — att betala (inkl moms)",
        totalOre: 325_200,
      },
    });
    const text = await persistedText();
    expect(text).toContain("Arvode (timkostnadsnorm)");
    expect(text).toContain("Klientens självrisk");
    // WinAnsi saknar tankstreck → PDF:en skriver bindestreck.
    expect(text).toContain("Betalt via aconto - faktura F-2026-0001");
    expect(text).toContain("Domstolen betalar - att betala");
    expect(text).not.toContain("Nedsättning"); // lumpen ersatt av itemiserade rader
    expect(text).not.toContain("Rådgivning"); // rådgivningstimmen syns ALDRIG på domstols-fakturan (#860)
  });

  it("sammanställning: rad per kategori + timpris, uträkningskedja till summa, spec efter (#925/#1200)", async () => {
    await generateFakturaFromTemplate({
      invoice: { id: asId<"InvoiceId">("inv-s1"), amount: 1_071_500, vatOre: 196_300, invoiceNumber: "F-2026-0055", invoiceDate: "2026-06-30" },
      matterId: asId<"MatterId">("m1"),
      recipient: "Staten",
      meta: { matterNumber: "2026-0020", matterTitle: "Vårdnadstvist Falk" },
      register: { mutateAsync: registerMutateAsync },
      utils,
      spec: {
        timeLines: [
          // 2026: timkostnadsnorm 1 626 kr/tim, tidsspillan 1 487 kr/tim.
          { date: "2026-02-01", description: "Arbete på timkostnadsnormen", minutes: 60, amountOre: 162_600 },
          { date: "2026-02-02", description: "Mer arbete, samma norm", minutes: 120, amountOre: 325_200 },
          { date: "2026-02-03", description: "Restid och väntetid", minutes: 120, amountOre: 297_400 },
        ],
        expenseLines: [{ date: "2026-01-20", description: "Ansökningsavgift", netOre: 90_000, grossOre: 90_000 }],
        totalMinutes: 300,
        arvodeNetOre: 785_200, arvodeVatOre: 196_300,
        expensesNetOre: 90_000, expensesVatOre: 0,
        grossOre: 1_071_500,
        deductions: [], deductionOre: 0, adjustmentOre: 0, payableOre: 1_071_500,
      },
    });
    const text = await persistedText();
    // En rad per kategori + timpris (norm 1 626 kr/tim + tidsspillan 1 487 kr/tim),
    // läst som uträkning: Benämning | Tim | Timpris | Belopp (#1200).
    expect(text).toContain("Sammanställning");
    expect(text).toContain("Benämning");
    expect(text).toContain("Timpris");
    expect(text).toContain(`${kr(162_600)}/tim`); // timkostnadsnorm 2026
    expect(text).toContain(`${kr(148_700)}/tim`); // tidsspillan 2026 (297 400 / 2 tim)
    // Utan arvodeskategori på raden (äldre faktura) räddas tidsspillan-normerna ur
    // taxan; resten benämns arvode (#953).
    expect(text).toContain("\nTimarvode\n");
    expect(text).toContain("\nTidsspillan\n");
    // Kedjan (#1200): summa arvode exkl moms → moms på arvode → utlägg exkl moms →
    // summa inkl moms. Utläggen är momsfria här → ingen momsrad för utlägg.
    const iArvode = text.indexOf("Summa arvode exkl moms");
    const iMoms = text.indexOf("Moms 25 % på arvode");
    const iExkl = text.indexOf("Utlägg exkl moms");
    const iSumma = text.indexOf("Summa inkl moms");
    expect(iArvode).toBeGreaterThan(-1);
    expect(iArvode).toBeLessThan(iMoms);
    expect(iMoms).toBeLessThan(iExkl);
    expect(iExkl).toBeLessThan(iSumma);
    expect(text).not.toContain("på utlägg");
    expect(text).toContain(kr(785_200)); // summa arvode exkl moms
    expect(text).toContain(kr(196_300)); // moms på arvode
    expect(text).toContain(kr(1_071_500)); // 785 200 + 196 300 + 90 000
    // Sammanställningen står FÖRE specifikationen, som börjar på en egen sida.
    const pages = await pdfPageTexts(persistGeneratedDoc.mock.calls[0]![0].bytes as Uint8Array);
    expect(pages[0]).toContain("Sammanställning");
    expect(pages[1]?.[0]).toBe("Specifikation");
    expect(pages[1]).toContain("Tidsspecifikation");
  });

  it("klientens självrisk-faktura (#876): tidsspec-TABELL + moms-trappa, spec-summeringen undertryckt", async () => {
    await generateFakturaFromTemplate({
      invoice: { id: asId<"InvoiceId">("inv-s"), amount: 31_300, vatOre: 16_260, invoiceNumber: "F-2026-0019", invoiceDate: "2026-07-10" },
      matterId: asId<"MatterId">("m1"),
      recipient: "Cecilia Carlsson",
      meta: { matterNumber: "2026-0010", matterTitle: "Umgängestvist Carlsson" },
      register: { mutateAsync: registerMutateAsync },
      utils,
      // Tidsspec ger TABELLEN (bug #1); breakdown ger moms-trappan (bug #3).
      spec: {
        timeLines: [{ date: "2026-03-02", description: "Genomgång av handlingar", minutes: 120, amountOre: 325_200 }],
        expenseLines: [], totalMinutes: 120,
        arvodeNetOre: 325_200, arvodeVatOre: 0, expensesNetOre: 0, expensesVatOre: 0,
        grossOre: 0, deductions: [], deductionOre: 0, adjustmentOre: 0, payableOre: 0,
      },
      breakdown: {
        rows: [
          { label: "Upparbetat arvode (exkl moms)", amountOre: 325_200, kind: "add" },
          { label: "Klientens självrisk 20 % (exkl moms)", amountOre: 65_040, kind: "add" },
          { label: "Moms 25 %", amountOre: 16_260, kind: "add" },
          { label: "Självrisk (inkl moms)", amountOre: 81_300, kind: "add" },
          { label: "Avgår aconto — faktura F-2026-0013 (2026-05-15)", amountOre: 50_000, kind: "deduct" },
        ],
        totalLabel: "Att betala (inkl moms)", totalOre: 31_300,
      },
    });
    const text = await persistedText();
    expect(text).toContain("Tidsspecifikation");               // #1 — underlaget syns
    expect(text).toContain("Genomgång av handlingar");
    expect(text).toContain("Upparbetat arvode (exkl moms)");    // #3 — basen märkt EXKL moms
    expect(text).toContain("Moms 25 %");                        // momsen redovisad …
    expect(text).toContain("Självrisk (inkl moms)");
    expect(text).toContain("Avgår aconto - faktura F-2026-0013");
    // … men spec-summeringen undertrycks när breakdown finns → ingen dubbel moms/summa.
    expect(text).not.toContain("Delsumma (inkl moms)");
  });
});
