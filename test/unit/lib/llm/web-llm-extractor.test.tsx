/**
 * Tester för pure-helpers i `WebLlmExtractor` + lifecycle:n med mockad
 * `@mlc-ai/web-llm`-modul.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebLlmExtractor, buildPrompt, parseJsonResponse } from "@/lib/client/llm/web-llm-extractor";
import type { ExtractionSchema } from "@/lib/server/llm/llm-extractor";

const schema: ExtractionSchema = {
  motpart: { type: "string", description: "Motpartens namn" },
  saknat: { type: "string?", description: "Något som kanske saknas" },
  belopp: { type: "number?", description: "Belopp i kr" },
  vittnen: { type: "string[]", description: "Lista av vittnen" },
};

describe("buildPrompt", () => {
  it("inkluderar varje schema-fält med typ + description", () => {
    const out = buildPrompt("Mål T 4711-26. Käranden Anders Andersson.", schema);
    expect(out).toContain("motpart (string)");
    expect(out).toContain("saknat (string?)");
    expect(out).toContain("belopp (number?)");
    expect(out).toContain("vittnen (string[])");
    expect(out).toContain("Motpartens namn");
  });

  it("klipper källtext över ~6000 tecken", () => {
    const long = "a".repeat(8000);
    const out = buildPrompt(long, schema);
    expect(out).toContain("text avkortad");
    expect(out.length).toBeLessThan(7000 + 500);
  });

  it("instruktion: ENBART JSON-objekt", () => {
    expect(buildPrompt("x", schema)).toContain("ENBART ett JSON-objekt");
  });
});

describe("parseJsonResponse", () => {
  it("parsar rent JSON-objekt", () => {
    const r = parseJsonResponse('{"motpart":"Bertil","vittnen":["A","B"]}', schema);
    expect(r.motpart).toBe("Bertil");
    expect(r.vittnen).toEqual(["A", "B"]);
  });

  it("plockar JSON ur kringtext", () => {
    const r = parseJsonResponse('Här kommer datan:\n```json\n{"motpart":"Cecilia"}\n```\nTack!', schema);
    expect(r.motpart).toBe("Cecilia");
  });

  it("trailing comma tolereras", () => {
    const r = parseJsonResponse('{"motpart":"Anna",}', schema);
    expect(r.motpart).toBe("Anna");
  });

  it("fyller i defaults för saknade fält", () => {
    const r = parseJsonResponse('{"motpart":"X"}', schema);
    expect(r.saknat).toBeNull();      // string? → null
    expect(r.belopp).toBeNull();      // number? → null
    expect(r.vittnen).toEqual([]);    // string[] → []
  });

  it("trasig respons → alla fält faller till defaults", () => {
    const r = parseJsonResponse("inte JSON alls!", schema);
    expect(r.motpart).toBe("");
    expect(r.saknat).toBeNull();
    expect(r.vittnen).toEqual([]);
  });

  it("balanserar nested JSON-objekt korrekt", () => {
    const raw = 'Prefix {"motpart":"Anna {nested}","x":1} suffix';
    const r = parseJsonResponse(raw, schema);
    expect(r.motpart).toBe("Anna {nested}");
  });
});

// ─── Lifecycle med mockad MLC-engine ──────────────────────────────────────

// vi.hoisted ser till att fns finns innan vi.mock() läses
const engineHoisted = vi.hoisted(() => ({
  CreateMLCEngine: vi.fn(),
}));
vi.mock("@mlc-ai/web-llm", () => engineHoisted);

beforeEach(() => {
  engineHoisted.CreateMLCEngine.mockReset();
});

describe("WebLlmExtractor lifecycle", () => {
  it("isReady() = false före warmup, true efter", async () => {
    engineHoisted.CreateMLCEngine.mockResolvedValue({
      chat: { completions: { create: vi.fn() } },
    });
    const e = new WebLlmExtractor({ modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC" });
    expect(e.isReady()).toBe(false);
    await e.warmup();
    expect(e.isReady()).toBe(true);
  });

  it("warmup kör bara EN gång även vid parallella anrop", async () => {
    engineHoisted.CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: vi.fn() } } });
    const e = new WebLlmExtractor({ modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC" });
    await Promise.all([e.warmup(), e.warmup(), e.warmup()]);
    expect(engineHoisted.CreateMLCEngine).toHaveBeenCalledTimes(1);
  });

  it("vidarebefordrar progress-callbacks från MLC till onProgress", async () => {
    engineHoisted.CreateMLCEngine.mockImplementation(async (_id, opts) => {
      opts.initProgressCallback({ progress: 0.42, text: "Fetching shard 5/12" });
      return { chat: { completions: { create: vi.fn() } } };
    });
    const events: Array<{ progress: number; text: string }> = [];
    const e = new WebLlmExtractor({
      modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      onProgress: (p) => events.push(p),
    });
    await e.warmup();
    expect(events).toContainEqual({ progress: 0.42, text: "Fetching shard 5/12" });
  });

  it("extract före warmup kastar tydligt fel", async () => {
    const e = new WebLlmExtractor({ modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC" });
    await expect(e.extract("text", schema)).rejects.toThrow(/warmup/);
  });

  it("extract använder chat.completions.create och parsar svar", async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { content: '{"motpart":"Bertil B"}' } }],
    }));
    engineHoisted.CreateMLCEngine.mockResolvedValue({ chat: { completions: { create } } });
    const e = new WebLlmExtractor({ modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC" });
    await e.warmup();
    const out = await e.extract("Mål T 1-23 mellan käranden Anna och svaranden Bertil B.", schema);
    expect(create).toHaveBeenCalledOnce();
    expect(out.motpart).toBe("Bertil B");
    expect(out.vittnen).toEqual([]);
  });
});
