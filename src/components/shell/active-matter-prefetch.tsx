"use client";

/**
 * `ActiveMatterPrefetch` (#1244) — self-hosted: juristens aktiva ärenden finns
 * offline, med dokument och sökbar text. Renderar ingenting.
 */

import { useEffect } from "react";
import { loadDocumentBlob } from "@/lib/client/backend/load-document-blob";
import { LocalDocumentTextStore } from "@/lib/client/backend/local-document-text";
import { createServerDownloadClient } from "@/lib/client/backend/server-download-client";
import { setDocumentContent } from "@/lib/client/demo/document-content-cache";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import { type ActiveMatterSource, startActiveMatterPrefetch } from "@/lib/client/firma/start-active-matter-prefetch";

/** Klientstoren (`CachingSyncDataStore`); `null` under uppstart. */
export function ActiveMatterPrefetch({ store }: { store: { store: { currentSource: unknown } } | null }) {
  useEffect(() => {
    if (!store) return;
    const client = createServerDownloadClient();
    return startActiveMatterPrefetch({
      // Samma inloggade id som den lokala routern kör som (demo-bootstrap).
      userId: loadFirmaConfig().principalId || "current-user",
      source: () => store.store.currentSource as ActiveMatterSource,
      loadBlob: (doc) => loadDocumentBlob(client, doc),
      texts: new LocalDocumentTextStore(),
      extract: async (input) => (await import("@/lib/shared/extract-text")).extractText(input),
      publish: setDocumentContent,
    });
  }, [store]);
  return null;
}
