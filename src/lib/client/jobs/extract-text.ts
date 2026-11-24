"use client";

/**
 * Textextraktion (PDF/DOCX/text) bor numera i `lib/shared/extract-text`
 * (delas med server-jobbet, #518). Re-exporteras här så klient-importörer
 * (register-workers, extract-text-dispatcher-registrar) fortsätter peka hit.
 */

export { extractText, detectKind } from "@/lib/shared/extract-text";
