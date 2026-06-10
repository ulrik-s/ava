"use client";

/**
 * `llm-config` — localStorage-baserad opt-in för in-browser LLM.
 *
 * AI:n är **AVSTÄNGD som default**. Användaren slår på den explicit i
 * /settings → laddar ner modellen (~700 MB - 2 GB) → används av
 * classify-document-jobbet för dokumentklassificering.
 *
 * Persisteras i `ava.llm` (eget keyspace — ska inte krocka med firma-config).
 */

/**
 * Whitelist av modeller som vi vågar exponera i UI:n. Värdena matchar
 * `@mlc-ai/web-llm` prebuiltAppConfig.model_list-strängar — checka in nya
 * här innan UI-toggle kan välja dem.
 */
import { z } from "zod";

import { loadFromStorage } from "@/lib/client/load-from-storage";

export const LLM_MODELS = [
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "Llama-3.2-3B-Instruct-q4f16_1-MLC",
] as const;
export type LlmModelId = (typeof LLM_MODELS)[number];

/** Default-modell — minst (~700 MB), snabbast warmup. */
export const DEFAULT_LLM_MODEL: LlmModelId = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

const KEY = "ava.llm";

// Zod vid parsegränsen (#187): enum-validerad modell + boolean, fältvis tolerans.
const llmConfigSchema = z.object({
  enabled: z.boolean().catch(false),
  modelId: z.enum(LLM_MODELS).catch(DEFAULT_LLM_MODEL),
});

type LlmConfig = z.infer<typeof llmConfigSchema>;

function loadConfig(): LlmConfig {
  return loadFromStorage(KEY, llmConfigSchema, { enabled: false, modelId: DEFAULT_LLM_MODEL });
}

function saveConfig(cfg: LlmConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export function isLlmEnabled(): boolean {
  return loadConfig().enabled;
}

export function setLlmEnabled(enabled: boolean): void {
  saveConfig({ ...loadConfig(), enabled });
}

export function getLlmModelId(): LlmModelId {
  return loadConfig().modelId;
}

export function setLlmModelId(modelId: LlmModelId): void {
  saveConfig({ ...loadConfig(), modelId });
}

export function resetLlmConfig(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
