/**
 * `WebLlmExtractor` — bindning mot @mlc-ai/web-llm.
 *
 * Kör en lokal LLM-modell i browser via WebGPU. Användaren laddar
 * ner modell-vikten explicit (typiskt 2–4 GB) som engångsoperation.
 * Sedan körs alla extractions lokalt — ingen data lämnar enheten.
 *
 * Designval:
 *   - **Lazy loading:** modellen laddas först vid första warmup() eller
 *     extract(). UI-koden kan bygga en `WebLlmExtractor`-instans utan
 *     att blocka rendring eller starta tunga downloads.
 *   - **DI:** `factory` injiceras → tester använder fake engine, prod
 *     använder default som dynamic-importerar @mlc-ai/web-llm.
 *   - **Idempotent warmup:** flera samtidiga anrop dedupar mot samma
 *     load-promise.
 *   - **DRY:** JSON-parsning återanvänder `parseWithRepair` från
 *     `services/document-analysis` så vi har samma reparation som
 *     server-side LLM-flödet.
 */

import { parseWithRepair } from "../services/document-analysis";
import type {
  ILlmExtractor,
  ExtractionSchema,
  ExtractionResult,
} from "./llm-extractor";

/**
 * Minimal interface mot @mlc-ai/web-llm — vi behöver bara `reload` +
 * chat-API. Detta gör DI testbar utan att importera hela biblioteket.
 */
export interface WebLlmEngine {
  reload(modelId: string): Promise<void>;
  chat: {
    completions: {
      create(opts: {
        messages: Array<{ role: "system" | "user"; content: string }>;
        max_tokens?: number;
        temperature?: number;
      }): Promise<{
        choices: Array<{ message: { content: string } }>;
      }>;
    };
  };
}

/**
 * Default-modell — `gemma3-1b-it-q4f16_1-MLC`.
 *
 * Bakgrund: huvudappen kör `ai/gemma4` via Docker Model Runner
 * (server-side, OpenAI-kompatibel). I browser-läget finns Gemma 4 ännu
 * inte konverterad till MLC-format (open feature request: mlc-ai/web-llm
 * issue #810). Vi väljer Gemma 3-1B för att hålla familjekonsistensen
 * — samma prompt-stil, samma "personlighet" — och för att 1B-modellen
 * är liten nog att ladda ner snabbt (~700 MB) och fungera på enheter
 * utan high-end GPU. När Gemma 4 dyker upp i MLC byter vi default.
 *
 * Trade-off: 1B är svag på komplex juridisk svenska. För riktigt
 * extraktionsjobb kan användaren byta till en större modell, t.ex.
 * `gemma-2-9b-it-q4f16_1-MLC` (~5 GB).
 */
export const DEFAULT_WEB_LLM_MODEL = "gemma3-1b-it-q4f16_1-MLC";

export interface WebLlmExtractorOpts {
  /**
   * Modell-id i web-llm-katalogen. Default `DEFAULT_WEB_LLM_MODEL`
   * (Gemma 3-1B). Se `prebuiltAppConfig.model_list` i @mlc-ai/web-llm
   * för fullständig lista.
   */
  modelId?: string;
  /**
   * Fabriksfunktion som returnerar en engine-instans. Default
   * dynamic-importerar `@mlc-ai/web-llm`.
   */
  factory?: () => Promise<WebLlmEngine>;
}

export class WebLlmExtractor implements ILlmExtractor {
  private engine: WebLlmEngine | null = null;
  private warmupPromise: Promise<void> | null = null;
  private readonly modelId: string;

  constructor(private opts: WebLlmExtractorOpts = {}) {
    this.modelId = opts.modelId ?? DEFAULT_WEB_LLM_MODEL;
  }

  isReady(): boolean {
    return this.engine !== null;
  }

  warmup(): Promise<void> {
    if (this.engine) return Promise.resolve();
    if (this.warmupPromise) return this.warmupPromise;
    this.warmupPromise = (async () => {
      const factory = this.opts.factory ?? defaultFactory;
      const engine = await factory();
      await engine.reload(this.modelId);
      this.engine = engine;
    })();
    return this.warmupPromise;
  }

  async extract(text: string, schema: ExtractionSchema): Promise<ExtractionResult> {
    if (!this.engine) await this.warmup();
    if (!this.engine) return {};

    const prompt = buildPrompt(text, schema);
    const response = await this.engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = parseWithRepair(content);
    return parsed && typeof parsed === "object"
      ? (parsed as unknown as ExtractionResult)
      : {};
  }
}

// ─── Prompt-konstruktion ─────────────────────────────────────────

const SYSTEM_PROMPT = `Du är en assistent som extraherar strukturerad data ur svenska juridiska
dokument. Returnera ENDAST ett JSON-objekt enligt schemat. Om ett fält
inte kan utvinnas från texten — utelämna det. Skriv inga förklaringar.`;

function buildPrompt(text: string, schema: ExtractionSchema): string {
  const fieldDescriptions = Object.entries(schema).map(([name, spec]) =>
    `- "${name}" (${spec.type}): ${spec.description}`,
  ).join("\n");

  return `Extrahera följande fält ur texten:

${fieldDescriptions}

Returnera ett JSON-objekt med dessa fält. Utelämna fält du inte hittar.

TEXT:
${text}

JSON:`;
}

// ─── Default factory (dynamic-import för bundle-storlek) ─────────

async function defaultFactory(): Promise<WebLlmEngine> {
  // Eslint complain om @mlc-ai/web-llm inte är installerat — vi
  // använder dynamic require som inte kollas av tsc.
  // I produktion installeras paketet vid behov via:
  //   yarn add @mlc-ai/web-llm
  // Använder en variable specifier för att undvika att bundlern
  // försöker resolva paketet vid build-time (det är opt-in).
  const moduleName = "@mlc-ai/web-llm";
  const mod = await import(/* @vite-ignore */ moduleName).catch(() => null);
  if (!mod) {
    throw new Error(
      "WebLLM är inte installerat. Kör `yarn add @mlc-ai/web-llm` om du vill aktivera in-browser-LLM.",
    );
  }
  return (mod as unknown as { CreateWebWorkerMLCEngine?: () => Promise<WebLlmEngine>; MLCEngine?: new () => WebLlmEngine }).MLCEngine
    ? new (mod as unknown as { MLCEngine: new () => WebLlmEngine }).MLCEngine()
    : (mod as unknown as WebLlmEngine);
}
