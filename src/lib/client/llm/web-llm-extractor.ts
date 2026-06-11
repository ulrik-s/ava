"use client";

/**
 * `WebLlmExtractor` — kör en lokal LLM i browsern via WebGPU (MLC-AI:s
 * `@mlc-ai/web-llm`). Helt offline efter att modellen är nedladdad.
 *
 * Lifecycle:
 *   1. `new WebLlmExtractor({ modelId, onProgress })`  — billigt, ingen I/O
 *   2. `warmup()`                                       — laddar modell
 *      (~700 MB - 2 GB första gången, cachas i Cache Storage av WebLLM)
 *   3. `extract(text, schema)`                          — JSON-mode prompt
 *
 * Designval:
 *   - **Dynamisk import** av `@mlc-ai/web-llm` så biblioteket aldrig
 *     träffar SSR / vitest:s node-projekt. Paketet är ~5 MB och kör
 *     WebGPU — onödigt att dra in i tester som inte rör LLM:n.
 *   - **JSON-mode** — vi ber LLM:n att svara med strikt JSON som matchar
 *     vårt schema. Parser:n är defensiv (extrahera första `{...}`-blocket
 *     ifall LLM:n droppar prefix-text trots prompt-instruktion).
 *   - **Pure-helpers** (`buildPrompt`, `parseJsonResponse`) exporteras
 *     separat för testbarhet utan att behöva instansiera WebGPU.
 */

import { z } from "zod";
import type { MLCEngine } from "@mlc-ai/web-llm";
import type { ExtractionResult, ExtractionSchema, FieldType, ILlmExtractor } from "@/lib/server/llm/llm-extractor";
import type { LlmModelId } from "./llm-config";

export interface ProgressEvent {
  /** Mellan 0 och 1; -1 = okänt. */
  progress: number;
  /** Mänskligt-läsbart status (t.ex. "Fetching model shard 3/22"). */
  text: string;
}

export interface WebLlmExtractorOpts {
  modelId: LlmModelId;
  onProgress?: (p: ProgressEvent) => void;
}

export class WebLlmExtractor implements ILlmExtractor {
  private engine: MLCEngine | null = null;
  private ready = false;
  private warmupPromise: Promise<void> | null = null;

  constructor(private readonly opts: WebLlmExtractorOpts) {}

  isReady(): boolean { return this.ready; }

  async warmup(): Promise<void> {
    if (this.ready) return;
    if (this.warmupPromise) return this.warmupPromise;
    this.warmupPromise = this.doWarmup().finally(() => { this.warmupPromise = null; });
    return this.warmupPromise;
  }

  private async doWarmup(): Promise<void> {
    // Dynamisk import — SSR/node-tester slipper ladda hela WebGPU-bibban.
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    this.engine = await CreateMLCEngine(this.opts.modelId, {
      initProgressCallback: (report: { progress: number; text: string }) => {
        this.opts.onProgress?.({
          progress: typeof report.progress === "number" ? report.progress : -1,
          text: report.text,
        });
      },
    });
    this.ready = true;
  }

  async extract(text: string, schema: ExtractionSchema): Promise<ExtractionResult> {
    if (!this.engine || !this.ready) {
      throw new Error("WebLlmExtractor.extract() anropad innan warmup() — kör warmup först.");
    }
    const prompt = buildPrompt(text, schema);
    const completion = await this.engine.chat.completions.create({
      messages: [
        { role: "system", content: "Du är en assistent som extraherar strukturerad data ur svenska juridiska dokument. Svara ALLTID med ett enda JSON-objekt utan kringtext." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 1024,
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    return parseJsonResponse(raw, schema);
  }
}

// ─── Pure helpers (testbara utan WebGPU) ───────────────────────────────────

/**
 * Bygg en JSON-mode prompt baserat på schema:t. Inkluderar en kort beskrivning
 * av varje fält + förväntad typ + truncated source-text.
 */
export function buildPrompt(text: string, schema: ExtractionSchema): string {
  const fields = Object.entries(schema)
    .map(([name, spec]) => `  - ${name} (${spec.type}): ${spec.description}`)
    .join("\n");
  // Klipp källtext till ~6000 tecken — passar i context-fönstret för 1B-modellen
  // och räcker för de flesta inlagor.
  const truncated = text.length > 6000 ? text.slice(0, 6000) + "\n[... text avkortad ...]" : text;
  return [
    "Extrahera följande fält som JSON. Returnera ENBART ett JSON-objekt.",
    "",
    "Fält:",
    fields,
    "",
    "Om ett fält saknas i texten → använd null (för '?'-typer) eller tom sträng/[]",
    "",
    "Dokumenttext:",
    `"""${truncated}"""`,
  ].join("\n");
}

/**
 * Parsa JSON ur en LLM-respons. Tolerant mot:
 *   - Markdown-fences (```json ... ```)
 *   - Förklarande text före/efter JSON-objektet
 *   - Trailing kommatecken (rensas)
 *
 * Saknade nycklar fylls i från schema-defaults så callern alltid får alla fält.
 */
export function parseJsonResponse(raw: string, schema: ExtractionSchema): ExtractionResult {
  const json = extractJsonObject(raw);
  // Zod vid parsegränsen (#187): LLM-svar är ostrukturerad text — validera
  // som objekt; första kandidaten rå, andra med trailing commas rensade.
  let parsed: Record<string, unknown> = {};
  for (const candidate of [json, json.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const obj = z.record(z.string(), z.unknown()).safeParse(JSON.parse(candidate));
      if (obj.success) { parsed = obj.data; break; }
    } catch { /* prova nästa kandidat, annars defaults */ }
  }
  const out: ExtractionResult = {};
  for (const [name, spec] of Object.entries(schema)) {
    out[name] = name in parsed ? parsed[name] : defaultForType(spec.type);
  }
  return out;
}

/** Hoppa förbi en JSON-sträng; returnerar index på avslutande citattecknet
 *  (eller strängens slut om den är oavslutad). `\`-escape hoppar nästa tecken. */
function skipString(raw: string, openQuoteIdx: number): number {
  for (let i = openQuoteIdx + 1; i < raw.length; i++) {
    if (raw[i] === "\\") { i++; continue; }
    if (raw[i] === '"') return i;
  }
  return raw.length;
}

function extractJsonObject(raw: string): string {
  // Hitta första `{` och balansera räknaren tills matching `}` (hoppar strängar).
  const start = raw.indexOf("{");
  if (start < 0) return "{}";
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') { i = skipString(raw, i); continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return raw.slice(start, i + 1);
  }
  return raw.slice(start); // unbalanced — låt JSON.parse misslyckas vid behov
}

function defaultForType(t: FieldType): unknown {
  if (t.endsWith("[]") || t.endsWith("[]?")) return [];
  if (t.endsWith("?")) return null;
  if (t.startsWith("number")) return 0;
  return "";
}
