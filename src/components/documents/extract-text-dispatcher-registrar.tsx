"use client";

/**
 * Registrar för text-extraction-job:s dispatcher.
 *
 * Workern (i jobb-kön) extraherar PDF/DOCX → text. Den behöver skriva
 * text-filen till FSA. Vi gör det via en ny tRPC-mutation
 * `document.writeText` som routar genom DemoDataStore → writeBack →
 * `documents/text/<id>.txt`.
 *
 * För now: enkel direktskrivning till FSA via dataStore (eftersom
 * documentText inte är en entity i Prisma-modellen utan bara en
 * write-back-händelse). Vi använder createNotify för att triggea
 * fsa-write-back utan att ändra in-memory state.
 */

import { useEffect } from "react";
import { setExtractTextDispatcher } from "@/client/lib/jobs/extract-text-dispatch";

export function ExtractTextDispatcherRegistrar() {
  useEffect(() => {
    setExtractTextDispatcher(async ({ documentId, text }) => {
      // Vi går runt tRPC och skriver direkt via writeBack:s 'documentText'-
      // entity. writeBack mountas i demo-bootstrap och triggas av
      // window-event för att inte koppla till React-trädet.
      window.dispatchEvent(new CustomEvent("ava:document-text-extracted", {
        detail: { documentId, text },
      }));
    });
    return () => setExtractTextDispatcher(null);
  }, []);
  return null;
}
