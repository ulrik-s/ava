/**
 * Tester för `document-kind` — delad filnamns-heuristik (#518).
 */

import { describe, expect, it } from "vitest-compat";
import { KIND_DESCRIPTIONS, KNOWN_KINDS, guessFromFilename } from "@/lib/shared/document-kind";

describe("guessFromFilename", () => {
  const cases: Array<[string, string]> = [
    ["Stämning Tingsrätten.pdf", "STAMNING"],
    ["kallelse-2026.pdf", "KALLELSE"],
    ["Kallelse till huvudförhandling.pdf", "KALLELSE"],
    ["Yttr soc_Aktbil 16.pdf", "INLAGA"], // förkortat yttrande (verkligt filnamn, #1156)
    ["Yttrande till tingsrätten.pdf", "INLAGA"], // inte DOM trots "tingsr"
    ["svaromål.docx", "INLAGA"],
    ["Överklagande dom.pdf", "INLAGA"],
    ["Dom 2026-01.pdf", "DOM"],
    ["beslut.pdf", "DOM"],
    ["bevis-foto.jpg", "BEVIS"],
    ["fullmakt.pdf", "FULLMAKT"],
    ["hyresavtal.docx", "AVTAL"],
    ["faktura-123.pdf", "FAKTURA"],
    ["expertrapport.pdf", "RAPPORT"],
    ["anteckningar.txt", "OKLASSIFICERAT"],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => {
      expect(guessFromFilename(name)).toBe(expected);
    });
  }

  it("alla utfall finns i KNOWN_KINDS", () => {
    for (const [name] of cases) {
      expect(KNOWN_KINDS).toContain(guessFromFilename(name));
    }
  });
});

describe("KIND_DESCRIPTIONS", () => {
  it("varje kategori har en beskrivning (LLM-prompten, #1156)", () => {
    for (const k of KNOWN_KINDS) expect(KIND_DESCRIPTIONS[k].length).toBeGreaterThan(5);
  });
});
