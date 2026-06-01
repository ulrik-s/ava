"use client";

/**
 * `generated-doc-cache` — in-memory blob-cache för dokument som genereras
 * client-side under en demo-session.
 *
 * Bakgrund: i demo-mode (GH Pages) finns ingen server som kan ta emot
 * upload eller persistera filer. När t.ex. en kostnadsräkning genereras
 * lever HTML-bytes:erna bara i browser-minnet — de når ALDRIG en URL som
 * GH Pages kan svara på. `documents/<id>/`-länkar 404:ar därför alltid.
 *
 * Lösning: stasha bytes:erna här när dokumentet genereras, och slå upp
 * dem via `openGeneratedDoc()` när användaren klickar på dokument-länken.
 * `URL.createObjectURL` ger en blob:-URL som öppnas i ny flik — funkar
 * identiskt på Mac, PC, iPad och Android.
 *
 * Livslängd: in-memory per tab. Reload → cachen tom. För persistens över
 * reload skulle vi behöva IndexedDB (kommande iteration om use-case kräver).
 */

interface CachedDoc {
  blob: Blob;
  fileName: string;
}

const cache = new Map<string, CachedDoc>();

/**
 * Lägg in ett genererat dokument i cachen. Wrappar bytes:erna i en Blob
 * med rätt MIME-type så `URL.createObjectURL` ger en URL som browsern
 * kan rendera direkt.
 *
 * För text-baserade MIME-types (text/html, text/plain…) tvingar vi
 * "; charset=utf-8" så svenska tecken renderas korrekt.
 */
export function stashGeneratedDoc(
  id: string,
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): void {
  const type = needsUtf8Charset(mimeType) ? `${mimeType}; charset=utf-8` : mimeType;
  // Kopiera bytes:erna till en fresh ArrayBuffer så Blob:ens typkonstruktor
  // är nöjd (TS-strikt: Uint8Array<ArrayBufferLike> ≠ BlobPart).
  const buf = new Uint8Array(bytes).buffer;
  const blob = new Blob([buf], { type });
  cache.set(id, { blob, fileName });
}

/** Returnerar true om dokumentet finns i cachen. */
export function hasGeneratedDoc(id: string): boolean {
  return cache.has(id);
}

/**
 * Skapa en blob:-URL för dokumentet (om det finns i cachen) och öppna
 * den i en ny flik via injicerad open-funktion. Returnerar true om
 * öppning skedde.
 *
 * Caller revoke:ar URL:en efter 60 s (browsern hinner ladda).
 */
export function openGeneratedDoc(
  id: string,
  open: (url: string, fileName: string) => void = defaultOpen,
): boolean {
  const entry = cache.get(id);
  if (!entry) return false;
  const url = URL.createObjectURL(entry.blob);
  open(url, entry.fileName);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

function defaultOpen(url: string): void {
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Töm cachen — bara för tester. */
export function clearGeneratedDocCache(): void {
  cache.clear();
}

function needsUtf8Charset(mime: string): boolean {
  const lower = mime.toLowerCase();
  return lower.startsWith("text/") || lower === "application/json" || lower === "application/xml";
}
