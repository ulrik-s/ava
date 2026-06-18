/**
 * `extractText` — universell textextraktion från PDF, DOCX och plain text.
 * Delad mellan klient (web-worker före klassificering) och server
 * (`classify-document`-jobbet, #518). Miljö-agnostisk: pdfjs legacy-build +
 * mammoth fungerar både i browser och Node/bun.
 *
 * Designval:
 *   - Pure-funktion (in: bytes/Blob, ut: string) → trivial att testa.
 *   - Dynamiska imports så pdfjs-dist (~3 MB) bara laddas när PDF används.
 *   - Fail-soft: okänd mime / fel i lib → tom sträng, aldrig exception.
 */

export interface ExtractInput {
  bytes: Uint8Array | ArrayBuffer | Blob;
  mimeType?: string;
  fileName?: string;
}

/** Ren text. Tom sträng = "kunde inte extrahera" (okänt format, lib-fel, …). */
export async function extractText(input: ExtractInput): Promise<string> {
  const kind = detectKind(input);
  const bytes = await toBytes(input.bytes);
  switch (kind) {
    case "text": return new TextDecoder().decode(bytes);
    case "pdf": return extractFromPdf(bytes);
    case "docx": return extractFromDocx(bytes);
    case "unknown":
    default:
      return "";
  }
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

async function extractFromPdf(bytes: Uint8Array): Promise<string> {
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
    return parts.join("\n\n");
  } catch (err) {
    console.warn("[extract] PDF-extraktion misslyckades:", err);
    return "";
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
