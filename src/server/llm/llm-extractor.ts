/**
 * `ILlmExtractor` — abstraktion för LLM-baserad strukturerad extraktion
 * från fri text.
 *
 * Två huvudsakliga produktions-implementationer:
 *   1. `WebLlmExtractor`  (Fas 4) — kör en lokal LLM i browser via WebGPU.
 *      Användaren laddar ner modellen explicit (opt-in) — ~2 GB.
 *   2. (Server-läget)     — använder befintliga services/document-analysis
 *      via en wrapper. Redan kopplad i regelmotorn.
 *
 * Designval (SOLID):
 *   - **Single responsibility:** extraktion. Inga side-effects.
 *   - **Open-closed:** ny LLM-backend = ny `ILlmExtractor`-impl.
 *   - **Liskov:** alla impl uppfyller samma kontrakt — bytbart via DI.
 *   - **Interface segregation:** smal yta (isReady, warmup, extract).
 *   - **Dependency inversion:** konsument (regelmotor, UI) beror på
 *     interfacet, inte konkreta backendar.
 *
 * Designval (DRY):
 *   - Schema-beskrivningen är samma som regelmotorns `llm.extract`-step
 *     använder. Inga dubbla definitioner.
 */

export type FieldType =
  | "string"      // krävd sträng
  | "string?"     // valfri sträng
  | "string[]"    // strängar (alltid array, kan vara tom)
  | "string[]?"   // valfri array
  | "number"      // krävd tal
  | "number?"     // valfritt tal
  | "date"        // ISO-datum
  | "date?";      // valfritt ISO-datum

export interface FieldSpec {
  type: FieldType;
  description: string;
}

export type ExtractionSchema = Record<string, FieldSpec>;

export type ExtractionResult = Record<string, unknown>;

export interface ILlmExtractor {
  /** Är modellen klar att användas? `false` t.ex. innan warmup() klart. */
  isReady(): boolean;

  /**
   * Förberedande arbete — för WebLLM laddar denna ner och initialiserar
   * modellen (~2 GB). Säker att kalla flera gånger; bara första anropet
   * gör arbete.
   */
  warmup(): Promise<void>;

  /** Extrahera strukturerad data från text. Schema styr fält-set. */
  extract(text: string, schema: ExtractionSchema): Promise<ExtractionResult>;
}

// ─── NoopExtractor: default, gör inget ────────────────────────────

/**
 * Default-extractor som returnerar tomt objekt. Används som fallback
 * när LLM-funktioner inte aktiverats av användaren.
 */
export class NoopExtractor implements ILlmExtractor {
  isReady(): boolean { return true; }
  async warmup(): Promise<void> { /* no-op */ }
  async extract(_text: string, _schema: ExtractionSchema): Promise<ExtractionResult> { return {}; }
}

// ─── StubExtractor: deterministisk för tester ─────────────────────

interface StubOptions {
  throwOn?: "warmup" | "extract";
}

/**
 * Test-stub som returnerar förkonfigurerad data oavsett input.
 * Spårar alla `extract()`-anrop i `calls`-arrayen.
 */
export class StubExtractor implements ILlmExtractor {
  public calls: Array<{ text: string; schema: ExtractionSchema }> = [];

  constructor(
    private result: ExtractionResult,
    private options: StubOptions = {},
  ) {}

  isReady(): boolean { return true; }

  async warmup(): Promise<void> {
    if (this.options.throwOn === "warmup") throw new Error("stub: warmup-fel");
  }

  async extract(text: string, schema: ExtractionSchema): Promise<ExtractionResult> {
    if (this.options.throwOn === "extract") throw new Error("stub: extract-fel");
    this.calls.push({ text, schema });
    return { ...this.result };
  }
}
