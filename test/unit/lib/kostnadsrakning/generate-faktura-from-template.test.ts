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
});
