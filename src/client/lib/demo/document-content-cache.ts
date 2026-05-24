"use client";

/**
 * Cache av textinnehåll för dokument — fyller på lazy vid demo-bootstrap.
 *
 * Demo-arkitekturen: textfiler (.md/.txt) i `documents/content/<id>.<ext>`
 * kan hämtas direkt och cachas som plain text. PDF/DOCX kräver
 * client-side extraktion (pdfjs-dist) → done in separate iteration.
 *
 * Designval:
 *   - In-memory Map keyed by document-id, single-source per session
 *   - Lazy fill: preloadDocumentContents() trigg:ar bakgrunds-hämtning
 *   - searchDocuments() läser med getDocumentContent() — saknad doc → ""
 *   - DRY: pure-function `fetchPlainText` testas direkt utan I/O-mock
 */

const cache = new Map<string, string>();

export interface ContentDoc {
  id: string;
  fileName?: string;
  storagePath?: string;
  mimeType?: string;
}

const TEXT_EXTS = new Set(["md", "txt", "json", "csv", "log", "html", "xml", "yaml", "yml"]);
const TEXT_MIMES = new Set([
  "text/markdown", "text/plain", "text/html", "text/csv",
  "application/json", "application/xml",
]);

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'isPlainTextDoc' has a complexity of 9. Maximum allowed is 8.)
export function isPlainTextDoc(doc: ContentDoc): boolean {
  const mime = doc.mimeType?.toLowerCase() ?? "";
  if (TEXT_MIMES.has(mime) || mime.startsWith("text/")) return true;
  const ext = (doc.storagePath ?? doc.fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return TEXT_EXTS.has(ext);
}

/**
 * Hämta text från en HTTP-resurs. Pure helper för injicerad fetch i tester.
 * Returnerar null vid 404/fel — caller bestämmer fallback.
 */
export async function fetchPlainText(
  url: string,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<string | null> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Pre-loada alla text-dokument från en bas-URL. Kör parallellt och fyller
 * cache:n. Kallas en gång vid demo-bootstrap.
 *
 * Två källor per doc:
 *   1. `documents/text/<id>.txt` — extraherad text från PDF/DOCX (priorit.)
 *   2. `documents/content/<id>.<ext>` — om filen själv är plain text (.md/.txt)
 *
 * Om #1 finns används den; annars #2 om plain text-typ.
 */
export async function preloadDocumentContents(
  docs: ContentDoc[],
  baseUrl: string,
  fetchFn?: typeof fetch,
): Promise<void> {
  const base = baseUrl.replace(/\/+$/, "");
  await Promise.all(docs.map(async (d) => {
    if (cache.has(d.id)) return;
    // Försök läsa extraherad text först (för PDF/DOCX/övrigt-bin)
    const extractedUrl = `${base}/documents/text/${d.id}.txt`;
    const extracted = await fetchPlainText(extractedUrl, fetchFn);
    if (extracted !== null && extracted.length > 0) {
      cache.set(d.id, extracted);
      return;
    }
    // Annars: om filen själv är plain text (.md/.txt) → läs direkt
    if (isPlainTextDoc(d)) {
      const path = d.storagePath ?? `documents/${d.id}`;
      const url = `${base}/${path.replace(/^\/+/, "")}`;
      const text = await fetchPlainText(url, fetchFn);
      if (text !== null) cache.set(d.id, text);
    }
  }));
}

/** Returnera cached content eller tom sträng. */
export function getDocumentContent(docId: string): string {
  return cache.get(docId) ?? "";
}

/** Direkt-skriv för test eller manuell injection. */
export function setDocumentContent(docId: string, content: string): void {
  cache.set(docId, content);
}

/** Töm cache (för tester). */
export function clearDocumentContentCache(): void {
  cache.clear();
}
