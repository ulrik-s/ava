/**
 * Test för fri-text-matchning av domstolsbetalningar mot förväntade fordringar
 * (#175). Kör mot den anonymiserade Domstolsverket-fixturen + syntetiska fall.
 */

import { describe, it, expect } from "vitest-compat";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCamtXml, type CamtTransaction } from "@/lib/shared/payments/camt-parse";
import {
  matchReceivables,
  type ReceivableCandidate,
} from "@/lib/shared/payments/match-receivables";

const FIXTURES = resolve(__dirname, "../../../fixtures/camt-seb");
const domstol = parseCamtXml(readFileSync(resolve(FIXTURES, "camt.053_domstolsverket.xml"), "utf8"));

function cand(over: Partial<ReceivableCandidate> & { id: string }): ReceivableCandidate {
  return { matterNumber: null, courtCaseNumber: null, expectedAmount: 0, settledReferences: [], ...over };
}

describe("matchReceivables — Domstolsverket-fixtur (#175)", () => {
  it("matchar en kostnadsräkning på MÅLNUMMER och föreslår delbeloppet", () => {
    // "1154602 3288-26 EXEMPELSSON" → RfrdDocAmt 7246.00.
    const out = matchReceivables(domstol.transactions, [
      cand({ id: "er-1", courtCaseNumber: "3288-26", expectedAmount: 8000_00 }),
    ]);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]!.receivableId).toBe("er-1");
    expect(out.suggestions[0]!.matchedBy).toBe("courtCaseNumber");
    expect(out.suggestions[0]!.amountOre).toBe(7246_00); // delbeloppet, ej hela tx
  });

  it("matchar på ÄRENDENUMMER när målnummer saknas", () => {
    const out = matchReceivables(domstol.transactions, [
      cand({ id: "er-2", matterNumber: "1160601" }), // "1160601 3330-26 DIAZ EXEMPEL"
    ]);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]!.matchedBy).toBe("matterNumber");
    expect(out.suggestions[0]!.amountOre).toBe(11963_00);
  });

  it("flera fordringar i samma fil matchas var för sig (split-betalning)", () => {
    const out = matchReceivables(domstol.transactions, [
      cand({ id: "a", courtCaseNumber: "3288-26" }),
      cand({ id: "b", courtCaseNumber: "5799-25" }), // "5291 5799-25 PARTNER MA" → 73143.00
    ]);
    const ids = out.suggestions.map((s) => s.receivableId).sort();
    expect(ids).toEqual(["a", "b"]);
    expect(out.suggestions.find((s) => s.receivableId === "b")!.amountOre).toBe(73143_00);
  });

  it("redan avprickad referens (dubblett) ger inget förslag", () => {
    const first = matchReceivables(domstol.transactions, [cand({ id: "er-1", courtCaseNumber: "3288-26" })]);
    const ref = first.suggestions[0]!.reference;
    const again = matchReceivables(domstol.transactions, [
      cand({ id: "er-1", courtCaseNumber: "3288-26", settledReferences: [ref] }),
    ]);
    expect(again.suggestions).toHaveLength(0);
  });

  it("inga fordringar konfigurerade → inga förslag", () => {
    expect(matchReceivables(domstol.transactions, []).suggestions).toHaveLength(0);
  });
});

describe("matchReceivables — syntetiska fall", () => {
  const tx = (over: Partial<CamtTransaction>): CamtTransaction => ({
    reference: "TX1",
    amountOre: 5000_00,
    currency: "SEK",
    creditDebit: "CRDT",
    valueDate: "2026-06-12",
    debtorName: "SVERIGES DOMSTOLAR",
    structuredRefs: [{ ref: "9999 4242-26 EXEMPEL", amountOre: 5000_00 }],
    freeTexts: [],
    ...over,
  });

  it("tvetväg: två fordringar med samma målnummer → granskning, ej förslag", () => {
    const out = matchReceivables([tx({})], [
      cand({ id: "x", courtCaseNumber: "4242-26" }),
      cand({ id: "y", courtCaseNumber: "4242-26" }),
    ]);
    expect(out.suggestions).toHaveLength(0);
    expect(out.review[0]!.reason).toBe("tvetydig");
    expect(out.review[0]!.candidateReceivableIds!.sort()).toEqual(["x", "y"]);
  });

  it("DEBIT-transaktion ignoreras (bara inbetalningar)", () => {
    const out = matchReceivables([tx({ creditDebit: "DBIT" })], [cand({ id: "x", courtCaseNumber: "4242-26" })]);
    expect(out.suggestions).toHaveLength(0);
  });

  it("för kort nyckel (<3 tecken) matchar inte (slumpskydd)", () => {
    const out = matchReceivables([tx({ structuredRefs: [{ ref: "12", amountOre: 100 }] })], [
      cand({ id: "x", courtCaseNumber: "12" }),
    ]);
    expect(out.suggestions).toHaveLength(0);
  });
});
