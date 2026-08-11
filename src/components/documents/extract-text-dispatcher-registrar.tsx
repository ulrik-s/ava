"use client";

/**
 * Registrar för text-extraction-job:s dispatcher.
 *
 * Workern (i jobb-kön) extraherar PDF/DOCX → text. Två saker ska hända när
 * texten landar, och båda görs här:
 *
 * 1. **Texten skrivs till FSA** — via writeBack:s `documentText`-entity
 *    (`documents/text/<id>.txt`), så innehållet blir sökbart. Vi går runt tRPC
 *    med ett window-event eftersom documentText inte är en entity i
 *    datamodellen utan bara en write-back-händelse.
 * 2. **Kontakt- och händelseförslag skapas** ur texten (#988) via
 *    `document.suggestFromText`. Det här är klient-tier:ernas väg in i
 *    `SuggestionsPanel`/`EventsPanel`: i demo och self-hosted når dokumentets
 *    bytes aldrig servern, så extraktionen måste utgå från texten browsern
 *    just har läst. (Server-first gör motsvarande i `classify-document`-
 *    jobbet, som läser bytes ur content-store:n.)
 *
 * Skrivningen är idempotent, så en omanalys av samma dokument ger inga
 * dubbletter — se `writeSuggestionsFromText`.
 */

import { useEffect } from "react";
import { setExtractTextDispatcher } from "@/lib/client/jobs/extract-text-dispatch";
import { trpc } from "@/lib/client/trpc";

export function ExtractTextDispatcherRegistrar() {
  const suggest = trpc.document.suggestFromText.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    setExtractTextDispatcher(async ({ documentId, text }) => {
      window.dispatchEvent(new CustomEvent("ava:document-text-extracted", {
        detail: { documentId, text },
      }));
      // Förslagen är en bonus ovanpå text-skrivningen: ett fel här får inte
      // förlora texten (som redan är dispatchad ovan) eller fälla jobbet.
      try {
        await suggest.mutateAsync({ documentId, text });
        await Promise.all([
          utils.document.pendingSuggestionsGrouped.invalidate(),
          utils.document.events.invalidate(),
        ]);
      } catch (err) {
        console.warn("[suggest-from-text] misslyckades:", err);
      }
    });
    return () => setExtractTextDispatcher(null);
  }, [suggest, utils]);
  return null;
}
