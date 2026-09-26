/**
 * `extractPages` (#1215) — text PER SIDA mot riktig pdfjs (ingen mock): en
 * flersidig PDF ger en sträng per sida, i ordning; DOCX/text är en enda sida;
 * okänt format/tom text → inga sidor. `extractText` är sidorna ihopslagna.
 */
import { describe, expect, it } from "vitest-compat";
import { extractPages, extractText, joinPages } from "@/lib/shared/extract-text";
import { minimalPdf } from "../../../helpers/minimal-pdf";

const pdfBytes = (pages: string[]): Uint8Array => new TextEncoder().encode(minimalPdf(pages));

describe("extractPages", () => {
  it("PDF med tre sidor → tre strängar i sidordning", async () => {
    const pages = await extractPages({ bytes: pdfBytes(["Stamning", "Bilaga ett", "Fullmakt"]), mimeType: "application/pdf" });
    expect(pages.map((p) => p.trim())).toEqual(["Stamning", "Bilaga ett", "Fullmakt"]);
  });

  it("extractText slår ihop sidorna med tom rad emellan", async () => {
    const text = await extractText({ bytes: pdfBytes(["Sida ett", "Sida tva"]), fileName: "a.pdf" });
    expect(text.split("\n\n").map((p) => p.trim())).toEqual(["Sida ett", "Sida tva"]);
  });

  it("plain text → en enda sida", async () => {
    expect(await extractPages({ bytes: new TextEncoder().encode("hej"), mimeType: "text/plain" })).toEqual(["hej"]);
  });

  it("tom textfil → inga sidor (och tom text)", async () => {
    const input = { bytes: new Uint8Array(), fileName: "tom.txt" };
    expect(await extractPages(input)).toEqual([]);
    expect(await extractText(input)).toBe("");
  });

  it("okänt format → inga sidor", async () => {
    expect(await extractPages({ bytes: new Uint8Array([1]), fileName: "x.bin" })).toEqual([]);
  });

  it("joinPages: samma form som extractText", () => {
    expect(joinPages(["a", "b"])).toBe("a\n\nb");
    expect(joinPages([])).toBe("");
  });
});
