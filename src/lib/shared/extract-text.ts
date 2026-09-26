/**
 * `extractText` — universell textextraktion från PDF, DOCX och plain text.
 * Delad mellan klient (web-worker före klassificering) och server
 * (`classify-document`-jobbet, #518). Miljö-agnostisk: pdfjs legacy-build +
 * mammoth fungerar både i browser och Node/bun.
 *
 * Designval:
 *   - Pure-funktion (in: bytes/Blob, ut: sidor/string) → trivial att testa.
 *   - `extractPages` är kärnan: en sträng per PDF-sida (sidgränserna behövs
 *     för sökindexet `document_pages`, #1215); DOCX/text saknar sidor → en
 *     enda "sida". `extractText` är sidorna ihopslagna.
 *   - Dynamiska imports så pdfjs-dist (~3 MB) bara laddas när PDF används.
 *   - Fail-soft: okänd mime / fel i lib → tom sträng, aldrig exception.
 */

export interface ExtractInput {
  bytes: Uint8Array | ArrayBuffer | Blob;
  mimeType?: string;
  fileName?: string;
}

/** Separator mellan sidor när de slås ihop till en text. */
const PAGE_SEPARATOR = "\n\n";

/**
 * Text per sida (index 0 = sida 1). PDF → en sträng per sida; DOCX/text → en
 * enda sida. Tom lista = "kunde inte extrahera" (okänt format, lib-fel, …).
 */
export async function extractPages(input: ExtractInput): Promise<string[]> {
  const kind = detectKind(input);
  if (kind === "unknown") return [];
  const bytes = await toBytes(input.bytes);
  if (kind === "pdf") return extractPdfPages(bytes);
  const text = kind === "text" ? new TextDecoder().decode(bytes) : await extractFromDocx(bytes);
  return text ? [text] : [];
}

/** Ren text (sidorna ihopslagna). Tom sträng = "kunde inte extrahera". */
export async function extractText(input: ExtractInput): Promise<string> {
  return joinPages(await extractPages(input));
}

/** Slå ihop sidor till en text (samma form som `extractText`). */
export function joinPages(pages: readonly string[]): string {
  return pages.join(PAGE_SEPARATOR);
}

type ExtractKind = "text" | "pdf" | "docx" | "unknown";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Datadriven kind-detektering: första regel som matchar mime-prefix/-likhet/ext. */
const KIND_RULES: ReadonlyArray<{ kind: ExtractKind; mimePrefix?: string; mimes: string[]; exts: string[] }> = [
  { kind: "text", mimePrefix: "text/", mimes: ["application/json"], exts: ["txt", "md", "csv", "log", "html", "xml", "yaml", "yml", "json"] },
  { kind: "pdf", mimes: ["application/pdf"], exts: ["pdf"] },
  { kind: "docx", mimes: [DOCX_MIME], exts: ["docx", "doc"] },
];

/** Filändelse (utan punkt, gemener) ur filnamnet; tom om ingen. */
function fileExt(fileName: string | undefined): string {
  return (fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

/** Vilken extraktor som ska användas för denna fil. */
export function detectKind(input: ExtractInput): ExtractKind {
  const mime = (input.mimeType ?? "").toLowerCase();
  const ext = fileExt(input.fileName);
  for (const r of KIND_RULES) {
    if ((r.mimePrefix && mime.startsWith(r.mimePrefix)) || r.mimes.includes(mime) || r.exts.includes(ext)) {
      return r.kind;
    }
  }
  return "unknown";
}

async function toBytes(input: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(await input.arrayBuffer());
}

async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  try {
    // Legacy-build för max-kompabilitet (Node/bun + jsdom). Re-exporterar
    // pdfjs-dists egna typer → fullt typad utan cast.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      try {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url,
        ).toString();
      } catch { /* fall through → fake-worker i samma tråd */ }
    }
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return parts;
  } catch (err) {
    console.warn("[extract] PDF-extraktion misslyckades:", err);
    return [];
  }
}

async function extractFromDocx(bytes: Uint8Array): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    });
    return result.value ?? "";
  } catch (err) {
    console.warn("[extract] DOCX-extraktion misslyckades:", err);
    return "";
  }
}
