/**
 * Minimal DOCX-skrivare för seed-dokumenten (#970).
 *
 * ## Varför den här finns
 *
 * Seed-datat genererade DOCX via `html-to-docx`. Det paketet drar in ~13
 * transitiva beroenden — bl.a. `lodash`, `virtual-dom`, `jszip` och
 * `image-size` — varav det sista har TVÅ high-CVE:er som saknar fix uppströms:
 * senast publicerade `image-size` (2.0.2) ligger själv i advisory-intervallet, och
 * `html-to-docx` kräver `^1.0.0`. De blockerade `bun audit`-grindens ratchet.
 *
 * AVA:s enda DOCX-generering är den här: en FAST mall (rubrik, underrubrik,
 * brödtext) som vi själva bygger strängen till. Inga bilder, ingen användar-HTML.
 * `image-size` var alltså aldrig nåbar hos oss — men den fanns i trädet ändå.
 *
 * Att äga ~120 rader OOXML är billigare än att äga den beroendekedjan.
 *
 * ## Vad en .docx är
 *
 * En ZIP med tre delar: `[Content_Types].xml` (vad filerna innehåller),
 * `_rels/.rels` (var huvuddokumentet ligger) och `word/document.xml` (innehållet).
 * Vi lagrar OKOMPRIMERAT (metod 0) — giltig ZIP, och Word bryr sig inte. Det gör
 * skrivaren beroendefri: ingen zlib, bara CRC-32 och rätt headers.
 *
 * Formateringen är DIREKT (fet + storlek på runs) i stället för namngivna stilar,
 * så vi slipper en `styles.xml` att hålla i synk för tre rubriknivåer.
 */

/** Fast tidsstämpel i ZIP-posterna → byte-stabil `out/` mellan seed-körningar. */
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

const enc = new TextEncoder();

// ── CRC-32 ────────────────────────────────────────────────────────────────
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── XML ───────────────────────────────────────────────────────────────────

/** Escapa text för XML. `&` först — annars dubbelescapas de andra. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const CONTENT_TYPES = `${XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** Ett stycke. `sizeHalfPoints`: Word mäter i halva punkter (28 = 14 pt). */
export interface DocxParagraph {
  text: string;
  bold?: boolean;
  /** Utelämnad → dokumentets standardstorlek. */
  sizeHalfPoints?: number;
}

function paragraphXml(p: DocxParagraph): string {
  const props = [
    p.bold === true ? "<w:b/>" : "",
    p.sizeHalfPoints === undefined ? "" : `<w:sz w:val="${p.sizeHalfPoints}"/><w:szCs w:val="${p.sizeHalfPoints}"/>`,
  ].join("");
  const rPr = props === "" ? "" : `<w:rPr>${props}</w:rPr>`;
  // `xml:space="preserve"` — annars äter Word inledande/avslutande blanksteg.
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(p.text)}</w:t></w:r></w:p>`;
}

export function documentXml(paragraphs: readonly DocxParagraph[]): string {
  return `${XML_HEAD}
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragraphs.map(paragraphXml).join("")}<w:sectPr/></w:body>
</w:document>`;
}

// ── ZIP (store-only) ──────────────────────────────────────────────────────

interface ZipEntry { name: string; bytes: Uint8Array; crc: number; offset: number }

/** Little-endian-skrivare — ZIP-formatet är LE genomgående. */
function le(values: ReadonlyArray<[bytes: 2 | 4, value: number]>): Uint8Array {
  const size = values.reduce((s, [n]) => s + n, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [n, v] of values) {
    if (n === 2) view.setUint16(at, v, true);
    else view.setUint32(at, v >>> 0, true);
    at += n;
  }
  return out;
}

function localHeader(name: Uint8Array, crc: number, size: number): Uint8Array {
  return concat([
    le([[4, 0x04034b50], [2, 20], [2, 0x0800], [2, 0], [2, DOS_TIME], [2, DOS_DATE],
      [4, crc], [4, size], [4, size], [2, name.length], [2, 0]]),
    name,
  ]);
}

function centralHeader(e: ZipEntry, name: Uint8Array): Uint8Array {
  return concat([
    le([[4, 0x02014b50], [2, 20], [2, 20], [2, 0x0800], [2, 0], [2, DOS_TIME], [2, DOS_DATE],
      [4, e.crc], [4, e.bytes.length], [4, e.bytes.length],
      [2, name.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, e.offset]]),
    name,
  ]);
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * Bygg en okomprimerad ZIP. Flaggan `0x0800` markerar UTF-8-namn — våra namn är
 * rena ASCII, men flaggan är gratis och gör formatet entydigt.
 */
export function zipStore(files: ReadonlyArray<{ name: string; content: string }>): Uint8Array {
  const local: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (const f of files) {
    const bytes = enc.encode(f.content);
    const name = enc.encode(f.name);
    const crc = crc32(bytes);
    const header = localHeader(name, crc, bytes.length);
    local.push(header, bytes);
    entries.push({ name: f.name, bytes, crc, offset });
    offset += header.length + bytes.length;
  }
  const central = entries.map((e) => centralHeader(e, enc.encode(e.name)));
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = le([[4, 0x06054b50], [2, 0], [2, 0], [2, entries.length], [2, entries.length],
    [4, centralSize], [4, offset], [2, 0]]);
  return concat([...local, ...central, eocd]);
}

// ── Publik yta ────────────────────────────────────────────────────────────

/** Bygg en .docx av stycken. Returnerar filens bytes. */
export function buildDocx(paragraphs: readonly DocxParagraph[]): Uint8Array {
  return zipStore([
    { name: "[Content_Types].xml", content: CONTENT_TYPES },
    { name: "_rels/.rels", content: ROOT_RELS },
    { name: "word/document.xml", content: documentXml(paragraphs) },
  ]);
}

/** Seed-dokumentets standardform: rubrik, underrubrik, brödtext. */
export function buildSimpleDocx(a: { title: string; heading: string; body: string }): Uint8Array {
  return buildDocx([
    { text: a.title, bold: true, sizeHalfPoints: 36 },   // 18 pt
    { text: a.heading, bold: true, sizeHalfPoints: 24 }, // 12 pt
    { text: a.body },
  ]);
}
