/**
 * Tester för text-extraktion. PDF/DOCX-bibliotek hanteras av integration:n;
 * vi testar primärt format-detektering och plain-text-pathway här.
 */

import { describe, it, expect } from "vitest";
import { extractText, detectKind } from "@/lib/client/jobs/extract-text";

describe("detectKind", () => {
  it("plain text via mime", () => {
    expect(detectKind({ bytes: new Uint8Array(), mimeType: "text/plain" })).toBe("text");
    expect(detectKind({ bytes: new Uint8Array(), mimeType: "text/markdown" })).toBe("text");
    expect(detectKind({ bytes: new Uint8Array(), mimeType: "text/html" })).toBe("text");
  });

  it("plain text via filändelse", () => {
    expect(detectKind({ bytes: new Uint8Array(), fileName: "a.md" })).toBe("text");
    expect(detectKind({ bytes: new Uint8Array(), fileName: "a.txt" })).toBe("text");
    expect(detectKind({ bytes: new Uint8Array(), fileName: "a.csv" })).toBe("text");
    expect(detectKind({ bytes: new Uint8Array(), fileName: "a.json" })).toBe("text");
  });

  it("PDF via mime + ext", () => {
    expect(detectKind({ bytes: new Uint8Array(), mimeType: "application/pdf" })).toBe("pdf");
    expect(detectKind({ bytes: new Uint8Array(), fileName: "x.pdf" })).toBe("pdf");
  });

  it("DOCX via mime + ext", () => {
    expect(detectKind({
      bytes: new Uint8Array(),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).toBe("docx");
    expect(detectKind({ bytes: new Uint8Array(), fileName: "x.docx" })).toBe("docx");
  });

  it("okänd formats", () => {
    expect(detectKind({ bytes: new Uint8Array(), fileName: "x.xyz" })).toBe("unknown");
    expect(detectKind({ bytes: new Uint8Array(), mimeType: "image/png" })).toBe("unknown");
  });
});

describe("extractText", () => {
  it("plain text: returnerar dekoderad string", async () => {
    const bytes = new TextEncoder().encode("Hej, världen.");
    const out = await extractText({ bytes, mimeType: "text/plain" });
    expect(out).toBe("Hej, världen.");
  });

  it("plain text via .md fileName", async () => {
    const bytes = new TextEncoder().encode("# Rubrik\n\nText.");
    const out = await extractText({ bytes, fileName: "doc.md" });
    expect(out).toContain("Rubrik");
  });

  it("JSON-fil läses som plain text", async () => {
    const bytes = new TextEncoder().encode('{"k":"v"}');
    const out = await extractText({ bytes, mimeType: "application/json" });
    expect(out).toBe('{"k":"v"}');
  });

  it("okänt format returnerar tom sträng (fail-soft)", async () => {
    const out = await extractText({ bytes: new Uint8Array([0, 1, 2]), fileName: "x.bin" });
    expect(out).toBe("");
  });

  it("accepterar Blob input", async () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    const out = await extractText({ bytes: blob, mimeType: "text/plain" });
    expect(out).toBe("test");
  });

  it("accepterar ArrayBuffer input", async () => {
    const buf = new TextEncoder().encode("buffer").buffer;
    const out = await extractText({ bytes: buf, mimeType: "text/plain" });
    expect(out).toBe("buffer");
  });
});
