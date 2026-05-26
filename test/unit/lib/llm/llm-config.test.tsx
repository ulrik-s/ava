/**
 * Tester för LLM-config — localStorage-baserade flaggor.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isLlmEnabled,
  setLlmEnabled,
  getLlmModelId,
  setLlmModelId,
  resetLlmConfig,
  DEFAULT_LLM_MODEL,
  type LlmModelId,
} from "@/lib/client/llm/llm-config";

const KEY = "ava.llm";

beforeEach(() => localStorage.clear());

describe("isLlmEnabled / setLlmEnabled", () => {
  it("default false när inget är sparat", () => {
    expect(isLlmEnabled()).toBe(false);
  });

  it("setLlmEnabled(true) → isLlmEnabled true", () => {
    setLlmEnabled(true);
    expect(isLlmEnabled()).toBe(true);
  });

  it("toggle av+på fungerar idempotent", () => {
    setLlmEnabled(true);
    setLlmEnabled(false);
    expect(isLlmEnabled()).toBe(false);
  });

  it("ignorerar korrupt JSON och returnerar default", () => {
    localStorage.setItem(KEY, "{kaos");
    expect(isLlmEnabled()).toBe(false);
  });
});

describe("getLlmModelId / setLlmModelId", () => {
  it("default modell är 1B Llama (snabb + ~700 MB)", () => {
    expect(getLlmModelId()).toBe(DEFAULT_LLM_MODEL);
    expect(DEFAULT_LLM_MODEL).toMatch(/Llama-3\.2-1B/);
  });

  it("persistar val", () => {
    const m: LlmModelId = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
    setLlmModelId(m);
    expect(getLlmModelId()).toBe(m);
  });

  it("setLlmEnabled bevarar modell-valet", () => {
    const m: LlmModelId = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
    setLlmModelId(m);
    setLlmEnabled(true);
    expect(getLlmModelId()).toBe(m);
    expect(isLlmEnabled()).toBe(true);
  });
});

describe("resetLlmConfig", () => {
  it("rensar nyckeln helt", () => {
    setLlmEnabled(true);
    setLlmModelId("Llama-3.2-3B-Instruct-q4f16_1-MLC");
    resetLlmConfig();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(isLlmEnabled()).toBe(false);
    expect(getLlmModelId()).toBe(DEFAULT_LLM_MODEL);
  });
});
