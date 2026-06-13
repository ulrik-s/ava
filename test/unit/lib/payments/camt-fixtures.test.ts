/**
 * Integritetstest för SEB:s camt.053/054-exempelfiler (testfixturer).
 *
 * Säkerställer att fixturerna i `test/fixtures/camt-seb/` finns, laddas och
 * bär de strukturer som avprickningen (#164/#173/#175) kommer förlita sig på:
 *   - rätt camt-namespace + root-element per meddelandetyp,
 *   - strukturerad referens (`RmtInf/Strd`, OCR-vägen #164) i BGC-filen,
 *   - ostrukturerad referens (`RmtInf/Ustrd`, fri-text-vägen #175) i SE-filen.
 *
 * När parsern byggs ska den köras mot dessa filer — testet garanterar att
 * fixturerna inte ruttnar (t.ex. råkar tas bort eller bytas ut) under tiden.
 */

import { describe, it, expect } from "vitest-compat";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../../fixtures/camt-seb");
const read = (name: string): string => readFileSync(resolve(DIR, name), "utf8");

const XML_FIXTURES = [
  { file: "camt.054_SE_CRED_BGC.xml", ns: "camt.054.001.02", root: "BkToCstmrDbtCdtNtfctn" },
  { file: "camt.054_SE.xml", ns: "camt.054.001.02", root: "BkToCstmrDbtCdtNtfctn" },
  { file: "camt.053_SE.xml", ns: "camt.053.001.02", root: "BkToCstmrStmt" },
  { file: "camt.053_SE_BGC_Credit.xml", ns: "camt.053.001.02", root: "BkToCstmrStmt" },
  { file: "camt.053_domstolsverket.xml", ns: "camt.053.001.02", root: "BkToCstmrStmt" },
] as const;

describe("SEB camt-fixturer", () => {
  it("alla fixtur-filer finns på plats", () => {
    for (const { file } of XML_FIXTURES) {
      expect(existsSync(resolve(DIR, file)), `${file} saknas`).toBe(true);
    }
    expect(existsSync(resolve(DIR, "camt.053.001.02.xsd"))).toBe(true);
    expect(existsSync(resolve(DIR, "camt.054.001.02.xsd"))).toBe(true);
  });

  for (const { file, ns, root } of XML_FIXTURES) {
    it(`${file}: rätt namespace (${ns}) + root (${root})`, () => {
      const xml = read(file);
      expect(xml.startsWith("<?xml")).toBe(true);
      expect(xml).toContain(`urn:iso:std:iso:20022:tech:xsd:${ns}`);
      expect(xml).toContain(`<${root}>`);
    });
  }

  it("BGC-filen bär en STRUKTURERAD referens (OCR-vägen, #164)", () => {
    const xml = read("camt.054_SE_CRED_BGC.xml");
    expect(xml).toContain("<Strd>");
    expect(xml).toContain("<Cd>CINV</Cd>"); // Commercial Invoice → faktura-/OCR-referens
  });

  it("SE-filen bär en OSTRUKTURERAD fri-text-referens (#175)", () => {
    const xml = read("camt.054_SE.xml");
    expect(xml).toContain("<Ustrd>");
    // Ingen Strd/CdtrRefInf-OCR i denna → just det fall avprickningen måste
    // klara via fri-text (målnummer / ärendereferens).
    expect(xml).not.toContain("<CdtrRefInf>");
  });

  it("Domstolsverket-filen: en betalning splittad över många kostnadsräkningar (#173/#175)", () => {
    const xml = read("camt.053_domstolsverket.xml");
    // Domstolsverket som betalare (Dbtr) — nyckeln för att känna igen
    // domstolsbetalningar utan AVA-faktura.
    expect(xml).toContain("SVERIGES DOMSTOLAR");
    // EN <Ntry>/<TxDtls> med MÅNGA <Strd> (kostnadsräkningar) → fri-text-refer
    // i <Nb> (fakturanr + målnr + namn), inte OCR. Minst 10 i exemplet.
    const strdCount = xml.split("<Strd>").length - 1;
    expect(strdCount).toBeGreaterThanOrEqual(10);
    // Får INTE innehålla verklig klient-PII (anonymiserad fixtur).
    expect(xml).not.toContain("GROSSKOPF");
    expect(xml).toContain("ANONYMISERAD");
  });

  it("XSD:erna är scheman för rätt camt-version", () => {
    expect(read("camt.053.001.02.xsd")).toContain('targetNamespace="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"');
    expect(read("camt.054.001.02.xsd")).toContain('targetNamespace="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"');
  });
});
