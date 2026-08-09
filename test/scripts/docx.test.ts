/**
 * Minimal DOCX-skrivare (#970) — ersatte `html-to-docx` och dess ~13 transitiva
 * paket, däribland `image-size` med två high-CVE:er utan fix uppströms.
 *
 * När man äger filformatet själv räcker det inte att testa att funktionen
 * returnerar bytes. Två saker måste hålla:
 *
 *   1. Filen ska vara en GILTIG ZIP med rätt delar — annars vägrar Word öppna den.
 *   2. Innehållet ska gå att LÄSA TILLBAKA. Round-tripen går genom `mammoth`,
 *      samma bibliotek som AVA själv extraherar DOCX-text med (`extract-text.ts`),
 *      så testet bevisar att appen kan läsa det seeden skriver.
 */
import { describe, it, expect } from "vitest-compat";

import { buildDocx, buildSimpleDocx, crc32, documentXml, escapeXml, zipStore } from "../../tooling/scripts/docx";

/** Läs en ZIP-post ur bytes — bara det testet behöver (store-only, ingen inflate). */
function readZipNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.length - 4; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue; // local file header
    const nameLen = view.getUint16(i + 26, true);
    names.push(new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen)));
  }
  return names;
}

describe("crc32", () => {
  it("matchar den kända checksumman för 'The quick brown fox jumps over the lazy dog'", () => {
    // Referensvärde ur ZIP-/PNG-specarnas standardtestvektor. Fel CRC → Word
    // säger att filen är skadad, och det syns inte förrän någon öppnar den.
    const bytes = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    expect(crc32(bytes)).toBe(0x414fa339);
  });

  it("tom indata ger 0", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("escapeXml", () => {
  it("escapar alla fem XML-tecknen", () => {
    expect(escapeXml(`<a href="x">&'</a>`))
      .toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });

  it("escapar & FÖRST — annars dubbelescapas de andra", () => {
    // Fel ordning ger "&amp;lt;" i stället för "&lt;".
    expect(escapeXml("<")).toBe("&lt;");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });

  it("rör inte svenska tecken (de bärs som UTF-8, inte entiteter)", () => {
    expect(escapeXml("å ä ö Å Ä Ö")).toBe("å ä ö Å Ä Ö");
  });
});

describe("documentXml", () => {
  it("lägger fet stil och storlek som DIREKTformatering", () => {
    const xml = documentXml([{ text: "Rubrik", bold: true, sizeHalfPoints: 36 }]);
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain('<w:sz w:val="36"/>');
  });

  it("stycke utan formatering får ingen tom rPr", () => {
    expect(documentXml([{ text: "Brödtext" }])).not.toContain("<w:rPr>");
  });

  it("bevarar blanksteg (xml:space) — annars äter Word dem", () => {
    expect(documentXml([{ text: "  indraget" }])).toContain('xml:space="preserve"');
  });

  it("escapar styckets text", () => {
    expect(documentXml([{ text: "Ärende <A & B>" }])).toContain("Ärende &lt;A &amp; B&gt;");
  });
});

describe("zipStore", () => {
  it("skriver en läsbar central directory med alla poster", () => {
    const zip = zipStore([{ name: "a.xml", content: "<a/>" }, { name: "b/c.xml", content: "<c/>" }]);
    expect(readZipNames(zip)).toEqual(["a.xml", "b/c.xml"]);
  });

  it("är deterministisk — samma indata ger byte-identisk utdata", () => {
    // Fast tidsstämpel i posterna. Utan den skulle varje seed-körning ge nya
    // bytes i `out/`, vilket bryter reproducerbara byggen.
    const a = zipStore([{ name: "x.xml", content: "<x/>" }]);
    const b = zipStore([{ name: "x.xml", content: "<x/>" }]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("buildDocx", () => {
  it("innehåller exakt de tre delar en .docx måste ha", () => {
    expect(readZipNames(buildDocx([{ text: "hej" }]))).toEqual([
      "[Content_Types].xml", "_rels/.rels", "word/document.xml",
    ]);
  });
});

describe("buildSimpleDocx — round-trip genom AVA:s egen DOCX-läsare", () => {
  /** Samma bibliotek som `extract-text.ts` använder för docx. */
  async function readBack(bytes: Uint8Array): Promise<string> {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return res.value;
  }

  it("texten kommer ut igen — rubrik, underrubrik och brödtext", async () => {
    const bytes = buildSimpleDocx({ title: "Dom från tingsrätten", heading: "Dokument", body: "Brödtext." });
    const text = await readBack(bytes);
    expect(text).toContain("Dom från tingsrätten");
    expect(text).toContain("Dokument");
    expect(text).toContain("Brödtext.");
  });

  it("svenska tecken överlever hela vägen", async () => {
    // UTF-8 i XML → ZIP → mammoth. Går encodingen fel syns det just här.
    const bytes = buildSimpleDocx({ title: "Å", heading: "Ä", body: "å, ä, ö, Å, Ä, Ö" });
    expect(await readBack(bytes)).toContain("å, ä, ö, Å, Ä, Ö");
  });

  it("XML-farliga tecken kommer tillbaka som sig själva, inte som entiteter", async () => {
    // Escapningen ska vara osynlig för läsaren. Läcker den igenom ser klienten
    // "&amp;" i dokumentet.
    const body = `Kärande <A & B> sa "nej" — 5 > 3`;
    const text = await readBack(buildSimpleDocx({ title: "T", heading: "H", body }));
    expect(text).toContain(body);
  });

  it("tom brödtext kraschar inte", async () => {
    expect(await readBack(buildSimpleDocx({ title: "T", heading: "H", body: "" }))).toContain("T");
  });
});
