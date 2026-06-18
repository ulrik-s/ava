/**
 * `createOllamaClassifier` (#518 Fas 3) — server-side dokumentklassificering
 * mot en OpenAI-kompatibel chat-endpoint (ollama via docker-`--profile llm`).
 *
 * Ingen klient-LLM, ingen modell-nedladdning hos användaren: servern frågar
 * sin egen ollama. Fail-soft hela vägen — för kort text, nät-fel, oväntat svar
 * eller okänd kategori → filnamns-heuristik (`guessFromFilename`). Så
 * klassificering ger ALLTID ett vettigt värde även om LLM:en är nere.
 */

import { KNOWN_KINDS, type DocumentKind, guessFromFilename } from "@/lib/shared/document-kind";

export interface LlmConfig {
  /** OpenAI-kompatibel bas-URL, t.ex. `http://ollama:11434/v1`. */
  endpoint: string;
  /** Modellnamn, t.ex. `llama3.2`. */
  model: string;
  /** Valfri API-nyckel (hostade tjänster). Ollama lokalt behöver ingen. */
  apiKey?: string;
}

/** Min antal tecken text för att ens fråga LLM:en (annars heuristik). */
const MIN_TEXT = 50;
const MAX_TEXT = 6000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Läs LLM-konfig ur env. Saknas endpoint/model → undefined (ingen server-LLM). */
export function loadLlmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | undefined {
  const endpoint = env.AVA_LLM_ENDPOINT?.trim();
  const model = env.AVA_LLM_MODEL?.trim();
  if (!endpoint || !model) return undefined;
  const key = env.AVA_LLM_API_KEY?.trim();
  return key ? { endpoint, model, apiKey: key } : { endpoint, model };
}

/** Plocka första kända kategorin ur ett LLM-svar (versal-matchning). */
function matchKind(raw: string): DocumentKind | null {
  const upper = raw.toUpperCase();
  return (KNOWN_KINDS as readonly string[]).find((k) => upper.includes(k)) as DocumentKind ?? null;
}

/** POST:a klassificerings-prompten till endpointen; null vid fel/okänt svar. */
async function askOllama(config: LlmConfig, doFetch: FetchLike, text: string): Promise<DocumentKind | null> {
  try {
    const res = await doFetch(`${config.endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        temperature: 0,
        messages: [
          { role: "system", content: "Du klassificerar svenska juridiska dokument. Svara med EXAKT ETT ord — en av kategorierna." },
          {
            role: "user",
            content: `Kategorier: ${KNOWN_KINDS.join(", ")}.\nVälj den som bäst beskriver dokumentet (OKLASSIFICERAT om ingen passar).\n\nDokument:\n"""${text.slice(0, MAX_TEXT)}"""`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return matchKind(body.choices?.[0]?.message?.content ?? "");
  } catch {
    return null; // nät-/parse-fel → anroparen faller tillbaka på heuristik
  }
}

/**
 * Bygg en klassificerare bunden till `config`. Returnerar en funktion
 * `(text, fileName) → DocumentKind` som anroparen (classify-handlern) matar
 * med extraherad dokumenttext. Fail-soft: kort text / LLM-miss → heuristik.
 */
export function createOllamaClassifier(
  config: LlmConfig,
  opts: { fetch?: FetchLike } = {},
): (text: string, fileName: string) => Promise<DocumentKind> {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  return async (text: string, fileName: string): Promise<DocumentKind> => {
    const heuristic = guessFromFilename(fileName);
    if (text.trim().length < MIN_TEXT) return heuristic;
    return (await askOllama(config, doFetch, text)) ?? heuristic;
  };
}
