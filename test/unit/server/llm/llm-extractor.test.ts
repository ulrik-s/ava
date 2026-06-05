/**
 * Tester för `ILlmExtractor`-interfacet och dess implementationer.
 *
 * Pattern: tester körs mot alla impl som uppfyller kontraktet — Liskov-
 * substituerbarhet bekräftas automatiskt.
 */

import { describe, it, expect } from "vitest";
import {
  NoopExtractor,
  StubExtractor,
  type ILlmExtractor,
  type ExtractionSchema,
} from "@/lib/server/llm/llm-extractor";

const schema: ExtractionSchema = {
  parter: { type: "string[]", description: "Namn på avtalets parter" },
  datum: { type: "date", description: "Datum då avtalet undertecknades" },
  belopp: { type: "number?", description: "Avtalsbelopp i kr (valfritt)" },
};

describe("ILlmExtractor — gemensamt kontrakt", () => {
  const impls: Array<[string, () => ILlmExtractor]> = [
    ["NoopExtractor", () => new NoopExtractor()],
    ["StubExtractor", () => new StubExtractor({ parter: ["Anna", "Björn"], datum: "2026-05-18" })],
  ];

  for (const [name, factory] of impls) {
    describe(name, () => {
      it("isReady() returnerar boolean utan att kasta", () => {
        const e = factory();
        expect(typeof e.isReady()).toBe("boolean");
      });

      it("extract() returnerar ett objekt — fält enligt schema eller tomt", async () => {
        const e = factory();
        const result = await e.extract("test-text", schema);
        expect(typeof result).toBe("object");
        expect(result).not.toBeNull();
      });
    });
  }
});

describe("NoopExtractor", () => {
  it("isReady() = true alltid (no-op behöver inget setup)", () => {
    expect(new NoopExtractor().isReady()).toBe(true);
  });

  it("extract() returnerar tomt objekt — inga fält extraheras", async () => {
    const e = new NoopExtractor();
    expect(await e.extract("Avtal mellan Anna och Björn 2026-05-18", schema)).toEqual({});
  });

  it("warmup() är no-op", async () => {
    await expect(new NoopExtractor().warmup()).resolves.toBeUndefined();
  });
});

describe("StubExtractor", () => {
  it("isReady() = true direkt (deterministisk för tester)", () => {
    expect(new StubExtractor({}).isReady()).toBe(true);
  });

  it("extract() returnerar förkonfigurerad data, ignorerar input", async () => {
    const e = new StubExtractor({ parter: ["A", "B"], datum: "2026-01-01" });
    expect(await e.extract("vilken text som helst", schema)).toEqual({
      parter: ["A", "B"], datum: "2026-01-01",
    });
  });

  it("extract() spårar anrop för assertions", async () => {
    const e = new StubExtractor({ foo: "bar" });
    await e.extract("text-1", schema);
    await e.extract("text-2", schema);
    expect(e.calls).toHaveLength(2);
    expect(e.calls[0].text).toBe("text-1");
    expect(e.calls[1].text).toBe("text-2");
  });

  it("kan konfigureras att kasta för fel-tester", async () => {
    const e = new StubExtractor({}, { throwOn: "extract" });
    await expect(e.extract("x", schema)).rejects.toThrow();
  });

  it("warmup() kan också konfigureras att kasta", async () => {
    const e = new StubExtractor({}, { throwOn: "warmup" });
    await expect(e.warmup()).rejects.toThrow();
  });
});
