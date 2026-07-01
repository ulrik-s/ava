/**
 * Tester för generateFakturaFromTemplate (#852) — faktura-dokument via template-
 * motorn (Handlebars): registrerar documentType=Faktura + invoiceId och renderar
 * fakturanummer/mottagare/belopp i HTML:en.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { generateFakturaFromTemplate } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
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
});
