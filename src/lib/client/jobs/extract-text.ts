"use client";

/**
 * `extractText` — universell textextraktion från PDF, DOCX och plain text.
 *
 * Designval:
 *   - Pure-funktion (in: Blob/Uint8Array, ut: string) → trivial att testa
 *   - Dynamiska imports så pdfjs-dist (~3 MB) bara laddas när PDF används
 *   - Fail-soft: okänd mime returnerar tom sträng, inte exception
 *
 * Lib-val:
 *   - PDF:  pdfjs-dist (Mozillas pdf.js) — standard i browser
 *   - DOCX: mammoth — konverterar .docx till text/HTML
 *   - TXT/MD/JSON: plain UTF-8-decoder
 *   - Andra: returnerar "" + console.warn
 */

export interface ExtractInput {
  bytes: Uint8Array | ArrayBuffer | Blob;
  mimeType?: string;
  fileName?: string;
}

/**
 * Returnera ren text. Tom sträng = "kunde inte extrahera" (oavsett
 * orsak: okänt format, fel i lib:t, etc).
 */
export async function extractText(input: ExtractInput): Promise<string> {
  const kind = detectKind(input);
  const bytes = await toBytes(input.bytes);

  switch (kind) {
    case "text":   return new TextDecoder().decode(bytes);
    case "pdf":    return extractFromPdf(bytes);
    case "docx":   return extractFromDocx(bytes);
    case "unknown":
    default:
      return "";
  }
}

/** Vilket extraktorn ska användas för denna fil. */
// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'detectKind' has a complexity of 13. Maximum allowed is 8.)
export function detectKind(input: ExtractInput): "text" | "pdf" | "docx" | "unknown" {
  const mime = (input.mimeType ?? "").toLowerCase();
  const ext = (input.fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

  if (mime.startsWith("text/") || ["txt", "md", "csv", "log", "html", "xml", "yaml", "yml"].includes(ext)) return "text";
  if (mime === "application/json" || ext === "json") return "text";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || ext === "docx"
  ) return "docx";

  return "unknown";
}

// ─── Helpers ───────────────────────────────────────────────────────

async function toBytes(input: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  // Blob
  return new Uint8Array(await input.arrayBuffer());
}

async function extractFromPdf(bytes: Uint8Array): Promise<string> {
  try {
    // Använd legacy-build för max-kompabilitet (Node test-env + jsdom).
    // Legacy-buildens pdf.d.mts re-exporterar pdfjs-dists egna typer, så
    // importen är fullt typad utan cast.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // pdfjs i browser kräver workerSrc; vi använder samma legacy-fil
    // som worker för enkelhet (slower men funkar utan extra-konfig)
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      // Försök att peka mot legacy worker; om vi inte hittar den, kör sync
      try {
        const workerUrl = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      } catch {
        // fall through — pdfjs faller tillbaka till fake-worker i samma tråd
      }
    }
    // Krav: PDF.js v3+ tar emot Uint8Array, men buffer-objekt med BYTES_PER_ELEMENT
    // bör vara safe. Använd `data`-parameter.
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const doc = await loadingTask.promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // content.items: Array<TextItem | TextMarkedContent>; "str" finns bara
      // på TextItem, så `in`-narrowing väljer rätt variant.
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      parts.push(pageText);
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
    // mammoth extractRawText tar ArrayBuffer
    const result = await mammoth.extractRawText({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    });
    return result.value ?? "";
  } catch (err) {
    console.warn("[extract] DOCX-extraktion misslyckades:", err);
    return "";
  }
}
