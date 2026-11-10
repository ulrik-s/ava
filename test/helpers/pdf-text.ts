/**
 * Testhjälp: plocka ut texten per sida ur en PDF som pdf-lib skrivit med
 * standardteckensnitt (#1218). Innehållsströmmarna är Flate-komprimerade och
 * texten ligger som hex-kodade WinAnsi-strängar (`<…> Tj`). WinAnsi och
 * Latin-1 sammanfaller för de tecken dokumentet använder (å, ä, ö, á, hårt
 * mellanslag), så Latin-1-avkodning räcker för att jämföra text.
 */
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFObject, type PDFRef } from "pdf-lib";

function streamsOf(doc: PDFDocument, contents: PDFObject | undefined): PDFRawStream[] {
  const resolved = contents instanceof PDFArray ? contents.asArray() : [contents];
  return resolved
    .map((o) => (o ? doc.context.lookup(o as PDFRef) : undefined))
    .filter((o): o is PDFRawStream => o instanceof PDFRawStream);
}

function decodeStream(s: PDFRawStream): string {
  const filter = s.dict.get(PDFName.of("Filter"));
  const bytes = filter ? inflateSync(s.contents) : Buffer.from(s.contents);
  return bytes.toString("latin1");
}

/** WinAnsi-koderna 0x80–0x9F som skiljer sig från Latin-1 (de dokumentet använder). */
const WIN_ANSI_EXTRA: Readonly<Record<string, string>> = { "\u0096": "–", "\u0097": "—" };

function textRuns(content: string): string[] {
  return [...content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) =>
    Buffer.from(m[1] ?? "", "hex").toString("latin1").replace(/[\u0096\u0097]/g, (c) => WIN_ANSI_EXTRA[c] ?? c)
      // Hårt mellanslag (tusentalsavgränsaren) → vanligt, så testerna kan skriva "1 626".
      .replace(/\u00A0/g, " "));
}

/** Varje sidas råa (avkodade) innehållsström — t.ex. för att se om en bild ritats (`Do`). */
export async function pdfPageContents(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => streamsOf(doc, page.node.get(PDFName.of("Contents"))).map(decodeStream).join("\n"));
}

/** Texten på varje sida, i ritordning (en körning per `Tj`). */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => streamsOf(doc, page.node.get(PDFName.of("Contents"))).flatMap((s) => textRuns(decodeStream(s))));
}

/** En ritad textkörning med position (#1506). `text` är rå WinAnsi/Latin-1 — samma
 *  sträng som mättes vid ritningen — så testet kan räkna fram högerkanten. */
export interface PdfTextRun { text: string; x: number; y: number; size: number; bold: boolean }

/** Ett ritat streck (pdf-lib `drawLine`: `x1 y1 m x2 y2 l`). */
export interface PdfLine { x1: number; y1: number; x2: number; y2: number }

const RUN_RE = /\/(\S+) ([\d.]+) Tf[\s\S]*?1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s*<([0-9A-Fa-f]*)>\s*Tj/g;
const LINE_RE = /([\d.-]+) ([\d.-]+) m\s+([\d.-]+) ([\d.-]+) l/g;

function runsOf(content: string): PdfTextRun[] {
  return [...content.matchAll(RUN_RE)].map((m) => ({
    text: Buffer.from(m[5] ?? "", "hex").toString("latin1"),
    x: Number(m[3]), y: Number(m[4]), size: Number(m[2]), bold: (m[1] ?? "").includes("Bold"),
  }));
}

/** Textkörningar med position per sida, i ritordning. */
export async function pdfPageRuns(bytes: Uint8Array): Promise<PdfTextRun[][]> {
  return (await pdfPageContents(bytes)).map(runsOf);
}

/** Streck per sida, i ritordning. */
export async function pdfPageLines(bytes: Uint8Array): Promise<PdfLine[][]> {
  return (await pdfPageContents(bytes)).map((c) => [...c.matchAll(LINE_RE)].map((m) => ({
    x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]),
  })));
}
