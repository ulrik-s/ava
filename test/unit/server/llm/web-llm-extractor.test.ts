/**
 * Tester för `WebLlmExtractor` — bindningen mot @mlc-ai/web-llm.
 *
 * Vi mockar bort `webLlmFactory` så testerna inte triggar nedladdning
 * av en flera-GB modell. Tester verifierar:
 *   - Lazy loading (instans skapas först vid warmup)
 *   - Prompt-konstruktion (schema → instruktion)
 *   - Response-parsning (JSON-extraktion via parseWithRepair)
 *   - Idempotent warmup
 */

import { describe, it, expect, vi } from "vitest";
import { WebLlmExtractor } from "@/server/llm/web-llm-extractor";
import type { ExtractionSchema } from "@/server/llm/llm-extractor";

const schema: ExtractionSchema = {
  parter: { type: "string[]", description: "Avtalsparter" },
  datum: { type: "date", description: "Avtalsdatum" },
};

function fakeEngine(opts: {
  response?: string;
  loadDelayMs?: number;
}) {
  return {
    reload: vi.fn(async (_model: string) => {
      if (opts.loadDelayMs) await new Promise((r) => setTimeout(r, opts.loadDelayMs));
    }),
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: opts.response ?? '{"parter": ["A", "B"], "datum": "2026-01-01"}' } }],
        })),
      },
    },
  };
}

describe("WebLlmExtractor — lazy initiering", () => {
  it("isReady() = false innan warmup()", () => {
    const e = new WebLlmExtractor({
      modelId: "test-model",
      factory: async () => fakeEngine({}),
    });
    expect(e.isReady()).toBe(false);
  });

  it("warmup() laddar modellen och isReady() blir true", async () => {
    const engine = fakeEngine({});
    const factory = vi.fn(async () => engine);
    const e = new WebLlmExtractor({ modelId: "test-model", factory });

    await e.warmup();
    expect(e.isReady()).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(engine.reload).toHaveBeenCalledWith("test-model");
  });

  it("warmup() är idempotent — andra anrop gör inget arbete", async () => {
    const factory = vi.fn(async () => fakeEngine({}));
    const e = new WebLlmExtractor({ modelId: "test-model", factory });
    await e.warmup();
    await e.warmup();
    await e.warmup();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("samtidiga warmup-anrop dedupar mot samma promise", async () => {
    const factory = vi.fn(async () => fakeEngine({ loadDelayMs: 50 }));
    const e = new WebLlmExtractor({ modelId: "test-model", factory });
    await Promise.all([e.warmup(), e.warmup(), e.warmup()]);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe("WebLlmExtractor — extract", () => {
  it("warmar automatiskt om extract() kallas utan warmup", async () => {
    const factory = vi.fn(async () => fakeEngine({}));
    const e = new WebLlmExtractor({ modelId: "x", factory });
    await e.extract("text", schema);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("returnerar parsad JSON enligt schema", async () => {
    const e = new WebLlmExtractor({
      modelId: "x",
      factory: async () => fakeEngine({
        response: '{"parter": ["Anna", "Björn"], "datum": "2026-05-18"}',
      }),
    });
    const result = await e.extract("text", schema);
    expect(result).toEqual({ parter: ["Anna", "Björn"], datum: "2026-05-18" });
  });

  it("hanterar response med JSON i markdown-kodblock", async () => {
    const e = new WebLlmExtractor({
      modelId: "x",
      factory: async () => fakeEngine({
        response: 'Här är resultatet:\n```json\n{"parter": ["A"]}\n```\nKlart.',
      }),
    });
    const result = await e.extract("text", schema);
    expect(result.parter).toEqual(["A"]);
  });

  it("returnerar tomt objekt om response saknar JSON", async () => {
    const e = new WebLlmExtractor({
      modelId: "x",
      factory: async () => fakeEngine({ response: "Jag kunde inte hitta något." }),
    });
    expect(await e.extract("text", schema)).toEqual({});
  });

  it("returnerar tomt objekt vid trasig JSON som inte går att reparera", async () => {
    const e = new WebLlmExtractor({
      modelId: "x",
      factory: async () => fakeEngine({ response: '{invalid: json' }),
    });
    expect(await e.extract("text", schema)).toEqual({});
  });

  it("prompten innehåller schema-fält-beskrivningar", async () => {
    const engine = fakeEngine({});
    const e = new WebLlmExtractor({
      modelId: "x",
      factory: async () => engine,
    });
    await e.extract("avtalstext", schema);
    const calls = engine.chat.completions.create.mock.calls as unknown as Array<[{ messages: Array<{ content: string }> }]>;
    expect(calls.length).toBeGreaterThan(0);
    const callArgs = calls[0][0];
    const userPrompt = callArgs.messages.find((m) => m.content.includes("avtalstext"));
    expect(userPrompt).toBeDefined();
    const allText = callArgs.messages.map((m) => m.content).join("\n");
    expect(allText).toContain("parter");
    expect(allText).toContain("Avtalsparter");
  });
});
