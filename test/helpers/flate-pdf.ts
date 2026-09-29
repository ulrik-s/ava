/**
 * PDF som liknar en riktig (#1252): komprimerade innehållsströmmar
 * (FlateDecode), WinAnsi-kodad text med svenska tecken och flera rader per
 * sida — så som ett ordbehandlat eller skannat-och-OCR:at dokument ser ut.
 * `minimalPdf` täcker sidgränserna; den här täcker det pdfjs faktiskt
 * måste avkoda i den kompilerade binären.
 */
import { deflateSync } from "node:zlib";

/** PDF-strängliteral i WinAnsi: specialtecken escapas, allt utanför ASCII som oktalt. */
function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0xff) throw new Error(`tecknet ${ch} finns inte i WinAnsi`);
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code > 0x7e) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return `(${out})`;
}

/** Innehållsström för en sida: en textrad per element, uppifrån och ned. */
function pageContent(lines: readonly string[]): string {
  const body = lines.map((l, i) => `${i === 0 ? "72 720 Td" : "0 -16 Td"} ${pdfString(l)} Tj`).join("\n");
  return `BT /F1 12 Tf\n${body}\nET`;
}

/** Bygg en PDF: en sida per element, varje sida en lista textrader. */
export function flatePdf(pages: ReadonlyArray<readonly string[]>): Uint8Array {
  const fontId = 3 + pages.length * 2;
  const pageIds = pages.map((_, i) => 3 + i * 2);
  const objs: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`),
    ...pages.flatMap((lines, i) => {
      const stream = deflateSync(Buffer.from(pageContent(lines), "latin1"));
      return [
        Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`),
        Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from("\nendstream")]),
      ];
    }),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let length = chunks[0]?.length ?? 0;
  const offsets = objs.map((body, i) => {
    const at = length;
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(obj);
    length += obj.length;
    return at;
  });
  const xref = [
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
  ].join("");
  chunks.push(Buffer.from(xref));
  return new Uint8Array(Buffer.concat(chunks));
}
