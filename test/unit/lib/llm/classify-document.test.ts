/**
 * Tester för `classifyDocument` — LLM-först-med-fallback-logiken.
 */

import { describe, it, expect, vi } from "vitest";
import { classifyDocument, guessFromFilename, KNOWN_KINDS } from "@/lib/client/llm/classify-document";
import { NoopExtractor, StubExtractor } from "@/lib/server/llm/llm-extractor";

describe("guessFromFilename (heuristik)", () => {
  it("matchar svenska och engelska varianter", () => {
    expect(guessFromFilename("Stämningsansökan.pdf")).toBe("STAMNING");
    expect(guessFromFilename("dom-tingsrätten.pdf")).toBe("DOM");
    expect(guessFromFilename("fullmakt-poa.pdf")).toBe("FULLMAKT");
    expect(guessFromFilename("hyresavtal.pdf")).toBe("AVTAL");
    expect(guessFromFilename("faktura-2024.pdf")).toBe("FAKTURA");
    expect(guessFromFilename("expertutlåtande.pdf")).toBe("RAPPORT");
    expect(guessFromFilename("bilaga.pdf")).toBe("BEVIS");
  });

  it("okänt filnamn → OKLASSIFICERAT", () => {
    expect(guessFromFilename("anteckning.pdf")).toBe("OKLASSIFICERAT");
  });
});

describe("classifyDocument", () => {
  it("ingen extractor → heuristik", async () => {
    expect(await classifyDocument({ fileName: "stämning.pdf" })).toBe("STAMNING");
  });

  it("extractor men ingen text → heuristik (skyddar mot tom prompt)", async () => {
    const x = new StubExtractor({ kind: "DOM" });
    expect(await classifyDocument({ fileName: "stämning.pdf", extractor: x })).toBe("STAMNING");
  });

  it("Noop-extractor → heuristik (Noop returnerar tomt)", async () => {
    expect(await classifyDocument({
      fileName: "stämning.pdf",
      text: "Käranden yrkar att...".padEnd(200, " filler "),
      extractor: new NoopExtractor(),
    })).toBe("STAMNING");
  });

  it("LLM ger giltigt kind → LLM vinner", async () => {
    const x = new StubExtractor({ kind: "DOM" });
    const result = await classifyDocument({
      fileName: "okänt-filnamn.pdf",
      text: "Tingsrätten meddelar härmed följande dom i mål T 4711-26 mellan Anders Andersson (kärande) och Bertil Bertilsson (svarande).",
      extractor: x,
    });
    expect(result).toBe("DOM");
  });

  it("LLM ger okänt kind → fall back på heuristik", async () => {
    const x = new StubExtractor({ kind: "TOTALT_PÅHITTAT" });
    expect(await classifyDocument({
      fileName: "fullmakt.pdf",
      text: "Härmed bemyndigas advokat Anna Advokat att företräda mig i samtliga frågor som rör vårdnadsmålet.",
      extractor: x,
    })).toBe("FULLMAKT");
  });

  it("LLM kastar → fall back på heuristik (graceful)", async () => {
    const x: import("@/lib/server/llm/llm-extractor").ILlmExtractor = {
      isReady: () => true,
      warmup: async () => {},
      extract: vi.fn(async () => { throw new Error("WebGPU bortkopplat"); }),
    };
    expect(await classifyDocument({
      fileName: "dom.pdf",
      text: "Tingsrätten meddelar härmed dom i målet. Käranden får rätt i sak.",
      extractor: x,
    })).toBe("DOM");
  });

  it("LLM-svar case-insensitive matchas", async () => {
    const x = new StubExtractor({ kind: "  bevis  " });
    expect(await classifyDocument({
      fileName: "ok.pdf",
      text: "Bilagor och vittnesförteckning för huvudförhandlingen den 12 maj.",
      extractor: x,
    })).toBe("BEVIS");
  });

  it("KNOWN_KINDS täcker alla heuristik-output", () => {
    const heuristicOutputs = [
      guessFromFilename("stämning"), guessFromFilename("dom"), guessFromFilename("bevis"),
      guessFromFilename("fullmakt"), guessFromFilename("avtal"), guessFromFilename("faktura"),
      guessFromFilename("rapport"), guessFromFilename("xxx"),
    ];
    for (const k of heuristicOutputs) expect(KNOWN_KINDS).toContain(k);
  });
});
