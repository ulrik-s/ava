/**
 * Tester för generateFakturaFromTemplate (#852) — faktura-dokument via template-
 * motorn (Handlebars): registrerar documentType=Faktura + invoiceId och renderar
 * fakturanummer/mottagare/belopp i HTML:en.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { generateFakturaFromTemplate } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { formatCurrency } from "@/lib/client/utils";
import { asId } from "@/lib/shared/schemas/ids";

const persistGeneratedDoc = vi.fn(async () => {});
vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc }));

const registerMutateAsync = vi.fn(async () => {});
const utils = {
  document: {
    tree: { invalidate: vi.fn(async () => {}), refetch: vi.fn(async () => {}) },
    list: { invalidate: vi.fn(async () => {}) },
  },
};

beforeEach(() => { vi.clearAllMocks(); });

describe("generateFakturaFromTemplate", () => {
  it("registrerar Faktura-dokument (HTML) kopplat till invoiceId + renderar mall-data", async () => {
    await generateFakturaFromTemplate({
      invoice: { id: asId<"InvoiceId">("inv-9"), amount: 203_250, vatOre: 40_650, invoiceNumber: "F-2026-0099", invoiceDate: "2026-06-30" },
      matterId: asId<"MatterId">("m1"),
      recipient: "Staten",
      meta: { matterNumber: "Ä-1", matterTitle: "Vårdnadstvist", organizationName: "Byrå AB" },
      register: { mutateAsync: registerMutateAsync },
      utils,
    });
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      matterId: "m1", documentType: "Faktura", invoiceId: "inv-9", mimeType: "text/html; charset=utf-8",
    }));
    expect(persistGeneratedDoc).toHaveBeenCalled();
    const html = new TextDecoder().decode(persistGeneratedDoc.mock.calls[0]![0].bytes as Uint8Array);
    expect(html).toContain("F-2026-0099"); // fakturanummer ur mallen
    expect(html).toContain("Staten");      // mottagare
    expect(html).toContain("Vårdnadstvist");
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
    const html = new TextDecoder().decode(persistGeneratedDoc.mock.calls[0]![0].bytes as Uint8Array);
    expect(html).toContain("Tidsspecifikation");
    expect(html).toContain("Genomgång av handlingar");
    expect(html).toContain("Utläggsspecifikation");
    expect(html).toContain("Ansökningsavgift");
    expect(html).toContain("Avgår aconto");
    expect(html).toContain("F-2026-0000"); // avdragen aconto-faktura listad i specifikationen
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
    const html = new TextDecoder().decode(persistGeneratedDoc.mock.calls[0]![0].bytes as Uint8Array);
    expect(html).toContain("Arvode (timkostnadsnorm)");
    expect(html).toContain("Klientens självrisk");
    expect(html).toContain("Betalt via aconto — faktura F-2026-0001");
    expect(html).toContain("Domstolen betalar — att betala");
    expect(html).not.toContain("Nedsättning"); // lumpen ersatt av itemiserade rader
    expect(html).not.toContain("Rådgivning"); // rådgivningstimmen syns ALDRIG på domstols-fakturan (#860)
  });

  it("sammanställning: sektion per timtaxa + utlägg exkl/inkl + summa, spec efter (#925)", async () => {
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
    const html = new TextDecoder().decode(persistGeneratedDoc.mock.calls[0]![0].bytes as Uint8Array);
    // En sektion per unik timtaxa (norm 1 626 kr/tim + tidsspillan 1 450 kr/tim),
    // varje rad med BENÄMNING + timtaxa i egna kolumner.
    expect(html).toContain("Sammanställning");
    expect(html).toContain("Benämning");
    expect(html).toContain("Timtaxa");
    expect(html).toContain(`${formatCurrency(162_600)}/tim`); // timkostnadsnorm 2026
    expect(html).toContain(`${formatCurrency(148_700)}/tim`); // tidsspillan 2026 (297 400 / 2 tim)
    // Utan arvodeskategori på raden (äldre faktura) räddas tidsspillan-normerna ur
    // taxan; resten benämns arvode (#953).
    expect(html).toContain("<td>Arvode</td>");
    expect(html).toContain("Tidsspillan — vardag 08–18");
    // Ordning i utläggsdelen: utlägg exkl moms → moms → utlägg inkl moms → summa.
    expect(html).toContain("Utlägg exkl moms");
    expect(html).toContain("<td>Moms</td>");
    expect(html).toContain("Utlägg inkl moms");
    expect(html).toContain("Summa (inkl moms)");
    const iExkl = html.indexOf("Utlägg exkl moms");
    const iMoms = html.indexOf("<td>Moms</td>");
    const iInkl = html.indexOf("Utlägg inkl moms");
    expect(iExkl).toBeLessThan(iMoms);
    expect(iMoms).toBeLessThan(iInkl);
    expect(html).toContain(formatCurrency(196_300)); // momsraden = arvodeVat + expensesVat
    expect(html).toContain(formatCurrency(1_071_500)); // summa = arvode inkl moms + utlägg inkl moms
    // Sammanställningen står FÖRE specifikationen; specen har sidbrytning.
    expect(html.indexOf("Sammanställning")).toBeLessThan(html.indexOf("Specifikation"));
    expect(html.indexOf("Sammanställning")).toBeLessThan(html.indexOf("Tidsspecifikation"));
    expect(html).toContain('class="page-break"');
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
    const html = new TextDecoder().decode(persistGeneratedDoc.mock.calls[0]![0].bytes as Uint8Array);
    expect(html).toContain("Tidsspecifikation");               // #1 — underlaget syns
    expect(html).toContain("Genomgång av handlingar");
    expect(html).toContain("Upparbetat arvode (exkl moms)");    // #3 — basen märkt EXKL moms
    expect(html).toContain("Moms 25 %");                        // momsen redovisad …
    expect(html).toContain("Självrisk (inkl moms)");
    expect(html).toContain("Avgår aconto — faktura F-2026-0013");
    // … men spec-summeringen undertrycks när breakdown finns → ingen dubbel moms/summa.
    expect(html).not.toContain("Delsumma (inkl moms)");
  });
});
