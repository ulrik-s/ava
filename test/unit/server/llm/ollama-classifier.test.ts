/**
 * Tester för `createOllamaPartClassifier` + `loadLlmConfigFromEnv` (#518 Fas 3, #1220).
 * Mockar fetch — verifierar OpenAI-kompatibelt anrop, kategori-matchning och
 * fail-soft till null (för kort text, nät-fel, okänt svar).
 */

import { describe, expect, it, vi } from "vitest-compat";
import { createOllamaPartClassifier, createOllamaTagSuggester, loadLlmConfigFromEnv, matchKind } from "@/lib/server/llm/ollama-classifier";

const cfg = { endpoint: "http://ollama:11434/v1", model: "llama3.2" };
const LONG = "Detta är ett juridiskt dokument med tillräckligt mycket text för att skickas till modellen för klassificering.";

function res(content: string): Response {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) } as Response;
}

describe("createOllamaPartClassifier (#1220)", () => {
  it("anropar OpenAI-kompatibel /chat/completions och matchar kategori", async () => {
    const fetchFn = vi.fn(async () => res("Kategorin är DOM."));
    const classify = createOllamaPartClassifier(cfg, { fetch: fetchFn });
    expect(await classify(LONG)).toBe("DOM");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://ollama:11434/v1/chat/completions");
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: "llama3.2", stream: false });
  });

  it("prompten beskriver varje kategori i klartext och ber om EN kod", async () => {
    const fetchFn = vi.fn(async () => res("STAMNING"));
    await createOllamaPartClassifier(cfg, { fetch: fetchFn })(LONG);
    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    const user = body.messages[1].content as string;
    expect(user).toContain("STAMNING = stämningsansökan");
    expect(user).toContain("FUP = förundersökningsprotokoll");
    expect(user).toContain("OKLASSIFICERAT = inget av ovanstående");
    expect(user).toContain("Ange aldrig flera koder");
    expect(body.messages[0].content).toContain("EXAKT EN kategorikod");
  });

  it("för kort text → null utan nätanrop", async () => {
    const fetchFn = vi.fn(async () => res("DOM"));
    expect(await createOllamaPartClassifier(cfg, { fetch: fetchFn })("kort")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("HTTP-fel / fetch kastar / okänt svar → null", async () => {
    const httpErr = vi.fn(async () => ({ ok: false, status: 500 } as Response));
    expect(await createOllamaPartClassifier(cfg, { fetch: httpErr })(LONG)).toBeNull();
    const throws = vi.fn(async () => { throw new Error("net down"); });
    expect(await createOllamaPartClassifier(cfg, { fetch: throws })(LONG)).toBeNull();
    const unknown = vi.fn(async () => res("vet inte riktigt"));
    expect(await createOllamaPartClassifier(cfg, { fetch: unknown })(LONG)).toBeNull();
  });

  it("skickar Authorization när apiKey satt", async () => {
    const fetchFn = vi.fn(async () => res("AVTAL"));
    await createOllamaPartClassifier({ ...cfg, apiKey: "sk-1" }, { fetch: fetchFn })(LONG);
    const headers = (fetchFn.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-1");
  });
});

describe("matchKind (#1220)", () => {
  it("tar FÖRSTA nämnda kategorin, inte den som ligger först i listan", () => {
    expect(matchKind("DOM, inte STAMNING")).toBe("DOM");
    expect(matchKind("Svar: kallelse")).toBe("KALLELSE");
    expect(matchKind("FUP")).toBe("FUP");
  });
  it("matchar hela ord — DOMSTOL är inte DOM", () => {
    expect(matchKind("Domstolen skriver")).toBeNull();
    expect(matchKind("")).toBeNull();
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
