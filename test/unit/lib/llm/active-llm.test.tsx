/**
 * Tester för `active-llm` singleton-koordinationen — välj Noop när
 * disabled, WebLlm när enabled; återskapa när model-id byts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { getActiveLlm, resetActiveLlm, subscribeLlmProgress, downloadActiveModel } from "@/lib/client/llm/active-llm";
import { setLlmEnabled, setLlmModelId, resetLlmConfig } from "@/lib/client/llm/llm-config";
import { NoopExtractor } from "@/lib/server/llm/llm-extractor";
import { WebLlmExtractor } from "@/lib/client/llm/web-llm-extractor";

// Mocka MLC så vi inte triggar någon riktig WebGPU-init
const engineHoisted = vi.hoisted(() => ({
  CreateMLCEngine: vi.fn(async () => ({
    chat: { completions: { create: vi.fn() } },
  })),
}));
vi.mock("@mlc-ai/web-llm", () => engineHoisted);

beforeEach(() => {
  resetActiveLlm();
  resetLlmConfig();
  engineHoisted.CreateMLCEngine.mockClear();
});

describe("getActiveLlm", () => {
  it("disabled (default) → NoopExtractor", () => {
    const llm = getActiveLlm();
    expect(llm).toBeInstanceOf(NoopExtractor);
    expect(llm.isReady()).toBe(true);
  });

  it("enabled → WebLlmExtractor-singleton (samma instans)", () => {
    setLlmEnabled(true);
    const a = getActiveLlm();
    const b = getActiveLlm();
    expect(a).toBeInstanceOf(WebLlmExtractor);
    expect(a).toBe(b);
  });

  it("byter modell → ny WebLlmExtractor-instans", () => {
    setLlmEnabled(true);
    setLlmModelId("Llama-3.2-1B-Instruct-q4f16_1-MLC");
    const a = getActiveLlm();
    setLlmModelId("Llama-3.2-3B-Instruct-q4f16_1-MLC");
    const b = getActiveLlm();
    expect(a).not.toBe(b);
  });

  it("toggle off → tillbaka till Noop", () => {
    setLlmEnabled(true);
    expect(getActiveLlm()).toBeInstanceOf(WebLlmExtractor);
    setLlmEnabled(false);
    expect(getActiveLlm()).toBeInstanceOf(NoopExtractor);
  });
});

describe("downloadActiveModel", () => {
  it("kastar om LLM inte är aktiverad", async () => {
    await expect(downloadActiveModel()).rejects.toThrow(/aktiverad/);
  });

  it("triggar warmup på den aktiva singleton", async () => {
    setLlmEnabled(true);
    await downloadActiveModel();
    expect(engineHoisted.CreateMLCEngine).toHaveBeenCalledOnce();
    expect(getActiveLlm().isReady()).toBe(true);
  });
});

describe("subscribeLlmProgress", () => {
  it("listeners får aktuell progress vid subscribe", () => {
    const seen: Array<{ progress: number; text: string }> = [];
    const unsub = subscribeLlmProgress((p) => seen.push(p));
    expect(seen.length).toBe(1); // initial state pushas direkt
    unsub();
  });

  it("listeners får uppdatering vid downloadActiveModel", async () => {
    setLlmEnabled(true);
    const seen: Array<{ progress: number; text: string }> = [];
    const unsub = subscribeLlmProgress((p) => seen.push(p));
    await downloadActiveModel();
    // initial + "Förbereder…" + "Klar" + ev. interna events
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]!.progress).toBe(1);
    unsub();
  });
});
