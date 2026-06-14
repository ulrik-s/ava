/**
 * Test för camt-parsern (#181) — körs mot SEB:s riktiga exempel-filer
 * (test/fixtures/camt-seb, #176).
 *
 * Nyckelfall:
 *   - camt.054 BGC: en Ntry (200 kr) → 2 TxDtls à 100 kr; den andra TxDtls
 *     bär TVÅ Strd-referenser med egna delbelopp (50+50) — en betalning som
 *     täcker två fakturor (domstols-scenariot i #175).
 *   - camt.053 BGC: samlad insättning 91 838 kr → 6 TxDtls vars summa stämmer.
 *   - camt.054 SE: fri-text-referenser (Ustrd), inga strukturerade.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest-compat";

import {
  parseCamtXml,
  camtFileSchema,
  camtTransactionSchema,
  camtStructuredRefSchema,
} from "@/lib/shared/payments/camt-parse";

const FIXTURES = resolve(__dirname, "../../../fixtures/camt-seb");
const read = (f: string): string => readFileSync(resolve(FIXTURES, f), "utf8");

describe("parseCamtXml — camt.054 BGC (strukturerade referenser)", () => {
  const file = parseCamtXml(read("camt.054_SE_CRED_BGC.xml"));

  it("itererar TxDtls, inte bara Ntry (1 Ntry → 2 transaktioner)", () => {
    expect(file.transactions).toHaveLength(2);
    expect(file.transactions.every((t) => t.creditDebit === "CRDT")).toBe(true);
    expect(file.transactions.every((t) => t.amountOre === 100_00)).toBe(true);
  });

  it("transaktion 1: en strukturerad referens (dokumentnr) med delbelopp", () => {
    const [t1] = file.transactions;
    expect(t1?.reference).toBe("STOIIQ0I220505085240644513000001"); // AcctSvcrRef
    expect(t1?.debtorName).toBe("Debtor");
    expect(t1?.structuredRefs).toEqual([{ ref: "98547", amountOre: 100_00 }]);
  });

  it("transaktion 2: TVÅ Strd-referenser med egna delbelopp (50+50)", () => {
    const t2 = file.transactions[1];
    expect(t2?.structuredRefs).toHaveLength(2);
    expect(t2?.structuredRefs.every((r) => r.amountOre === 50_00)).toBe(true);
    const sum = (t2?.structuredRefs ?? []).reduce((s, r) => s + (r.amountOre ?? 0), 0);
    expect(sum).toBe(t2?.amountOre);
  });
});

describe("parseCamtXml — camt.053 BGC (samlad insättning)", () => {
  it("en Ntry på 91 838 kr → 6 TxDtls vars belopp summerar exakt", () => {
    const file = parseCamtXml(read("camt.053_SE_BGC_Credit.xml"));
    expect(file.transactions).toHaveLength(6);
    const sum = file.transactions.reduce((s, t) => s + t.amountOre, 0);
    expect(sum).toBe(91_838_00);
    // Alla bär minst en strukturerad referens.
    expect(file.transactions.every((t) => t.structuredRefs.length > 0)).toBe(true);
  });
});

describe("parseCamtXml — camt.054 SE (fri text)", () => {
  const file = parseCamtXml(read("camt.054_SE.xml"));

  it("plockar Ustrd som freeTexts (inga strukturerade referenser)", () => {
    const withFree = file.transactions.filter((t) => t.freeTexts.length > 0);
    expect(withFree.length).toBeGreaterThan(0);
    expect(file.transactions.every((t) => t.structuredRefs.length === 0)).toBe(true);
  });

  it("känd transaktion: 157 145 SEK med Ustrd '3071358' och valutadatum", () => {
    const tx = file.transactions.find((t) => t.freeTexts.includes("3071358"));
    expect(tx).toBeDefined();
    expect(tx?.amountOre).toBe(157_145_00);
    expect(tx?.currency).toBe("SEK");
    expect(tx?.valueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("transaktionsreferenser är unika (idempotens-nyckeln)", () => {
    const refs = file.transactions.map((t) => t.reference);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("parseCamtXml — felfall", () => {
  it("kastar på icke-camt-XML", () => {
    expect(() => parseCamtXml("<foo/>")).toThrow(/camt/);
    expect(() => parseCamtXml("<Document><Other/></Document>")).toThrow(/camt\.053\/054/);
  });
});

describe("zod-validering vid parsegränsen (#185)", () => {
  const VALID_TX = {
    reference: "REF-1", amountOre: 100_00, currency: "SEK", valueDate: "2026-06-01",
    debtorName: "Klient AB", creditDebit: "CRDT", structuredRefs: [], freeTexts: [],
  };

  it("camtTransactionSchema avvisar trasiga fält (strikta datatyper)", () => {
    expect(camtTransactionSchema.safeParse(VALID_TX).success).toBe(true);
    expect(camtTransactionSchema.safeParse({ ...VALID_TX, creditDebit: "KRED" }).success).toBe(false);
    expect(camtTransactionSchema.safeParse({ ...VALID_TX, valueDate: "01/06/2026" }).success).toBe(false);
    expect(camtTransactionSchema.safeParse({ ...VALID_TX, amountOre: 100.5 }).success).toBe(false);
    expect(camtTransactionSchema.safeParse({ ...VALID_TX, currency: "sek" }).success).toBe(false);
    expect(camtTransactionSchema.safeParse({ ...VALID_TX, reference: "" }).success).toBe(false);
  });

  it("camtStructuredRefSchema kräver icke-tom referens + heltals-delbelopp", () => {
    expect(camtStructuredRefSchema.safeParse({ ref: "98547", amountOre: 50_00 }).success).toBe(true);
    expect(camtStructuredRefSchema.safeParse({ ref: "", amountOre: null }).success).toBe(false);
    expect(camtStructuredRefSchema.safeParse({ ref: "98547", amountOre: 12.3 }).success).toBe(false);
  });

  it("parseCamtXml failar HÖGT på fil med okänd CdtDbtInd (validering, inte propagering)", () => {
    const bad = `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>M</MsgId></GrpHdr>
    <Ntfctn><Ntry>
      <Amt Ccy="SEK">10.00</Amt>
      <CdtDbtInd>KREDIT</CdtDbtInd>
      <ValDt><Dt>2026-06-01</Dt></ValDt>
    </Ntry></Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;
    expect(() => parseCamtXml(bad)).toThrow();
  });

  it("fixturernas utdata passerar camtFileSchema oförändrat (round-trip)", () => {
    const file = parseCamtXml(read("camt.054_SE_CRED_BGC.xml"));
    expect(camtFileSchema.safeParse(file).success).toBe(true);
  });
});

describe("parseCamtXml — Domstolsverket (#173/#175, anonymiserad real-fixtur)", () => {
  const file = parseCamtXml(read("camt.053_domstolsverket.xml"));

  it("parsar utan fel + passerar schemat", () => {
    expect(camtFileSchema.safeParse(file).success).toBe(true);
    expect(file.transactions.length).toBeGreaterThan(0);
  });

  it("hittar Domstolsverkets betalning med MÅNGA kostnadsräknings-referenser", () => {
    const dom = file.transactions.find((t) => (t.debtorName ?? "").includes("SVERIGES DOMSTOLAR"));
    expect(dom).toBeTruthy();
    expect(dom!.amountOre).toBe(185_351_00);
    // En betalning → 10 strukturerade referenser (fri-text Nb, ej OCR).
    expect(dom!.structuredRefs.length).toBe(10);
    // Referenserna bär fakturanr + målnr i fri text (matchningsnyckel #175).
    expect(dom!.structuredRefs.some((r) => r.ref.includes("3288-26"))).toBe(true);
  });
});
