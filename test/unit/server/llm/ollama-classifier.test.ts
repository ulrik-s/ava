/**
 * Tester för `createOllamaClassifier` + `loadLlmConfigFromEnv` (#518 Fas 3).
 * Mockar fetch — verifierar OpenAI-kompatibelt anrop, kategori-matchning och
 * fail-soft till filnamns-heuristik (för kort text, nät-fel, okänt svar).
 */

import { describe, expect, it, vi } from "vitest-compat";
import { createOllamaClassifier, createOllamaTagSuggester, loadLlmConfigFromEnv } from "@/lib/server/llm/ollama-classifier";

const cfg = { endpoint: "http://ollama:11434/v1", model: "llama3.2" };
const LONG = "Detta är ett juridiskt dokument med tillräckligt mycket text för att skickas till modellen för klassificering.";

function res(content: string): Response {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) } as Response;
}

describe("createOllamaClassifier", () => {
  it("anropar OpenAI-kompatibel /chat/completions och matchar kategori", async () => {
    const fetchFn = vi.fn(async () => res("Kategorin är DOM."));
    const classify = createOllamaClassifier(cfg, { fetch: fetchFn });
    expect(await classify(LONG, "skannat.pdf")).toBe("DOM");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://ollama:11434/v1/chat/completions");
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: "llama3.2", stream: false });
  });

  it("för kort text → filnamns-heuristik utan nätanrop", async () => {
    const fetchFn = vi.fn(async () => res("DOM"));
    const classify = createOllamaClassifier(cfg, { fetch: fetchFn });
    expect(await classify("kort", "faktura-9.pdf")).toBe("FAKTURA");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("HTTP-fel → heuristik", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500 } as Response));
    const classify = createOllamaClassifier(cfg, { fetch: fetchFn });
    expect(await classify(LONG, "stämning.pdf")).toBe("STAMNING");
  });

  it("fetch kastar → heuristik", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("net down"); });
    const classify = createOllamaClassifier(cfg, { fetch: fetchFn });
    expect(await classify(LONG, "avtal.pdf")).toBe("AVTAL");
  });

  it("okänt svar → heuristik", async () => {
    const fetchFn = vi.fn(async () => res("vet inte riktigt"));
    const classify = createOllamaClassifier(cfg, { fetch: fetchFn });
    expect(await classify(LONG, "fullmakt.docx")).toBe("FULLMAKT");
  });

  it("skickar Authorization när apiKey satt", async () => {
    const fetchFn = vi.fn(async () => res("AVTAL"));
    const classify = createOllamaClassifier({ ...cfg, apiKey: "sk-1" }, { fetch: fetchFn });
    await classify(LONG, "x.pdf");
    const headers = (fetchFn.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-1");
  });
});

describe("createOllamaTagSuggester (#621 B2)", () => {
  const VOCAB = ["Sekretess", "Brådskande", "Original"];

  it("returnerar delmängden LLM:en nämner (⊆ vokabulären)", async () => {
    const fetchFn = vi.fn(async () => res("Sekretess, Original"));
    const suggest = createOllamaTagSuggester(cfg, { fetch: fetchFn });
    expect(await suggest(LONG, VOCAB)).toEqual(["Sekretess", "Original"]);
  });

  it("filtrerar bort hallucinerade taggar utanför vokabulären", async () => {
    const fetchFn = vi.fn(async () => res("Sekretess, Påhittad, Topphemlig"));
    const suggest = createOllamaTagSuggester(cfg, { fetch: fetchFn });
    expect(await suggest(LONG, VOCAB)).toEqual(["Sekretess"]);
  });

  it("tom vokabulär → ingen LLM, tom lista", async () => {
    const fetchFn = vi.fn(async () => res("x"));
    const suggest = createOllamaTagSuggester(cfg, { fetch: fetchFn });
    expect(await suggest(LONG, [])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("för kort text → ingen LLM, tom lista", async () => {
    const fetchFn = vi.fn(async () => res("Sekretess"));
    const suggest = createOllamaTagSuggester(cfg, { fetch: fetchFn });
    expect(await suggest("kort", VOCAB)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("nät-fel → tom lista (fail-soft)", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("net down"); });
    const suggest = createOllamaTagSuggester(cfg, { fetch: fetchFn });
    expect(await suggest(LONG, VOCAB)).toEqual([]);
  });
});

describe("loadLlmConfigFromEnv", () => {
  it("kräver endpoint + model", () => {
    expect(loadLlmConfigFromEnv({})).toBeUndefined();
    expect(loadLlmConfigFromEnv({ AVA_LLM_ENDPOINT: "http://x/v1" })).toBeUndefined();
    expect(loadLlmConfigFromEnv({ AVA_LLM_ENDPOINT: "http://x/v1", AVA_LLM_MODEL: "m" }))
      .toEqual({ endpoint: "http://x/v1", model: "m" });
  });

  it("inkluderar apiKey när satt", () => {
    expect(loadLlmConfigFromEnv({ AVA_LLM_ENDPOINT: "http://x/v1", AVA_LLM_MODEL: "m", AVA_LLM_API_KEY: "k" }))
      .toEqual({ endpoint: "http://x/v1", model: "m", apiKey: "k" });
  });
});
