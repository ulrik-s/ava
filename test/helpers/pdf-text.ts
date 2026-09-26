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
