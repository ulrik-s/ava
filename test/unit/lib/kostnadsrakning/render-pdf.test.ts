/**
 * `renderKostnadsrakningPdf` — client-side PDF (pdf-lib) av en kostnadsräkning.
 * Verifierar att den producerar en giltig PDF (%PDF-header) för både taxa- och
 * icke-taxa-fallet (förhandling > maxgräns) utan att kasta.
 */
import { describe, it, expect } from "vitest-compat";
import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";
import { renderKostnadsrakningPdf } from "@/lib/client/kostnadsrakning/render-pdf";

function pdfHeader(bytes: Uint8Array): string {
  return String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
}

describe("renderKostnadsrakningPdf", () => {
  it("producerar en PDF ur taxa-contexten (130 min, nivå 1) med utlägg", async () => {
    const result = buildKostnadsrakningContext({
      matter: { matterNumber: "B 2026-1234", title: "Brottmål Falk", clientName: "Fredrik Falk" },
      defender: { name: "Anna Advokat", email: "anna@firma.local" },
      organization: { name: "Firma AB", orgNumber: "556677-8899" },
      courtName: "Stockholms tingsrätt",
      hufStart: new Date("2026-04-15T09:00:00Z"),
      hufEnd: new Date("2026-04-15T11:10:00Z"), // 130 min
      taxaLevel: 1, hasFTax: true,
      expenses: [{ id: "x1", date: new Date("2026-04-15T00:00:00Z"), description: "Parkering", amount: 8750, vatIncluded: true }],
    });
    const bytes = await renderKostnadsrakningPdf({
      result,
      meta: {
        matterNumber: "B 2026-1234", matterTitle: "Brottmål Falk", clientName: "Fredrik Falk",
        courtName: "Stockholms tingsrätt", defenderName: "Anna Advokat",
        organizationName: "Firma AB", organizationOrgNumber: "556677-8899",
      },
    });
    expect(pdfHeader(bytes)).toBe("%PDF");
    expect(bytes.byteLength).toBeGreaterThan(800);
  });

  it("renderar icke-taxa (förhandling > 3 tim 45 min) utan att kasta", async () => {
    const result = buildKostnadsrakningContext({
      matter: { matterNumber: "B 2026-2", title: "Lång HUF" },
      defender: { name: "Anna" },
      hufStart: new Date("2026-04-15T09:00:00Z"),
      hufEnd: new Date("2026-04-15T14:00:00Z"), // 5 h → icke-taxa
      taxaLevel: 1, hasFTax: true, expenses: [],
    });
    const bytes = await renderKostnadsrakningPdf({
      result,
      meta: { matterNumber: "B 2026-2", matterTitle: "Lång HUF", clientName: "", courtName: "", defenderName: "Anna" },
    });
    expect(pdfHeader(bytes)).toBe("%PDF");
  });
});
