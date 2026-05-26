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
export const LLM_MODELS = [
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "Llama-3.2-3B-Instruct-q4f16_1-MLC",
] as const;
export type LlmModelId = (typeof LLM_MODELS)[number];

/** Default-modell — minst (~700 MB), snabbast warmup. */
export const DEFAULT_LLM_MODEL: LlmModelId = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

const KEY = "ava.llm";

interface LlmConfig {
  enabled: boolean;
  modelId: LlmModelId;
}

function loadConfig(): LlmConfig {
  if (typeof window === "undefined") return { enabled: false, modelId: DEFAULT_LLM_MODEL };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { enabled: false, modelId: DEFAULT_LLM_MODEL };
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    const modelId = (LLM_MODELS as readonly string[]).includes(parsed.modelId as string)
      ? (parsed.modelId as LlmModelId)
      : DEFAULT_LLM_MODEL;
    return { enabled: Boolean(parsed.enabled), modelId };
  } catch {
    return { enabled: false, modelId: DEFAULT_LLM_MODEL };
  }
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
