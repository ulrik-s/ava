/**
 * Tester för extractText:s format-extraktorer (#27 coverage) — PDF (pdfjs) +
 * DOCX (mammoth) via mockade dynamiska imports, plus Blob/ArrayBuffer-input
 * (toBytes-grenarna). Plain-text/detectKind täcks i extract-text.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { extractText } from "@/lib/client/jobs/extract-text";

let pdfThrows = false;
const pdfDoc = {
  numPages: 2,
  getPage: async (i: number) => ({
    getTextContent: async () => ({ items: [{ str: `sida${i}` }, { str: "text" }, { foo: "ingen str" }] }),
  }),
};
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" }, // tom → utövar worker-url-grenen
  getDocument: () => ({ promise: pdfThrows ? Promise.reject(new Error("trasig PDF")) : Promise.resolve(pdfDoc) }),
}));
vi.mock("mammoth", () => ({ extractRawText: async () => ({ value: "Word-dokumentets text" }) }));

beforeEach(() => { pdfThrows = false; });

describe("extractText — PDF (pdfjs)", () => {
  it("extraherar text från alla sidor (str-items, hoppar över icke-str)", async () => {
    const out = await extractText({ bytes: new Uint8Array([1, 2]), mimeType: "application/pdf" });
    expect(out).toContain("sida1");
    expect(out).toContain("sida2");
    expect(out).toContain("text");
  });

  it("fail-soft: trasig PDF → tom sträng", async () => {
    pdfThrows = true;
    const out = await extractText({ bytes: new Uint8Array([1]), fileName: "x.pdf" });
    expect(out).toBe("");
  });
});

describe("extractText — DOCX (mammoth)", () => {
  it("extraherar rå text via mammoth", async () => {
    const out = await extractText({ bytes: new Uint8Array([1]), fileName: "x.docx" });
    expect(out).toBe("Word-dokumentets text");
  });
});

describe("extractText — toBytes-grenar", () => {
  it("accepterar Blob-input", async () => {
    const blob = new Blob(["hej blob"], { type: "text/plain" });
    const out = await extractText({ bytes: blob, mimeType: "text/plain" });
    expect(out).toBe("hej blob");
  });

  it("accepterar ArrayBuffer-input", async () => {
    const buf = new TextEncoder().encode("hej buffer").buffer;
    const out = await extractText({ bytes: buf, fileName: "a.txt" });
    expect(out).toBe("hej buffer");
  });
});
