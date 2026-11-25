import { describe, it, expect } from "vitest-compat";
import { assertAttached, e2eAttachment, minimalPdf } from "../../../tooling/scripts/fortnox-attachment";

/**
 * Bilagan i Fortnox-E2E:n (#1886). Skarpt prövas den bara i nattkörningen, så
 * här vaktas det som går att se utan nät: att PDF:en är giltig (xref-offseten
 * pekar på objekten) och att ett utfall med attachmentError fäller körningen.
 */
describe("minimalPdf (#1886)", () => {
  const text = new TextDecoder().decode(minimalPdf());

  it("börjar med PDF-huvudet och slutar med %%EOF", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  it("xref-tabellens offset pekar exakt på varje objekt", () => {
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(3);
    offsets.forEach((o, i) => expect(text.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it("startxref pekar på xref-tabellen", () => {
    const at = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    expect(text.slice(at).startsWith("xref\n0 4\n")).toBe(true);
  });
});

describe("e2eAttachment (#1886)", () => {
  it("namnger filen efter fakturan och är en PDF", () => {
    const a = e2eAttachment("E2E-20261125");
    expect(a.fileName).toBe("E2E-20261125.pdf");
    expect(a.contentType).toBe("application/pdf");
    expect(a.bytes.length).toBeGreaterThan(0);
  });
});

describe("assertAttached (#1886)", () => {
  it("släpper igenom ett utfall utan attachmentError", () => {
    expect(() => assertAttached({ attachmentError: null })).not.toThrow();
  });

  it("fäller med skälet när bilagan inte kopplades", () => {
    expect(() => assertAttached({ attachmentError: "Fortnox fil-koppling 403" }))
      .toThrow(/kopplades inte.*fil-koppling 403/);
  });
});
