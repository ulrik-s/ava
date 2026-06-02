/**
 * `renderFakturaPdf` — client-side faktura-PDF (pdf-lib). Verifierar giltig PDF
 * för både full och minimal input.
 */
import { describe, it, expect } from "vitest";
import { renderFakturaPdf } from "@/lib/client/kostnadsrakning/render-faktura-pdf";

const head = (b: Uint8Array) => String.fromCharCode(b[0], b[1], b[2], b[3]);

describe("renderFakturaPdf", () => {
  it("producerar en faktura-PDF med alla fält", async () => {
    const bytes = await renderFakturaPdf({
      invoice: { amount: 1_047_500, invoiceNumber: "F-2026-1", invoiceDate: new Date("2026-05-12") },
      meta: {
        matterNumber: "B 2026-1234", matterTitle: "Brottmål Falk", clientName: "Fredrik Falk",
        recipient: "Domstolsverket", organizationName: "Firma AB", organizationOrgNumber: "556677-8899",
      },
    });
    expect(head(bytes)).toBe("%PDF");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("klarar minimal input (bara belopp + mål)", async () => {
    const bytes = await renderFakturaPdf({ invoice: { amount: 50_000 }, meta: { matterNumber: "B-2", matterTitle: "T" } });
    expect(head(bytes)).toBe("%PDF");
  });
});
