"use client";

/**
 * `useEagerCacheMatterDocuments` (ADR 0028 §4a) — när ett ärende öppnas i
 * server-first-läge, eager-cacha ärendets dokument-bytes i IndexedDB (via
 * `loadDocumentBlob`, cache-först) så de blir offline-tillgängliga. Körs en
 * gång per ärende, best-effort, och bara när en server finns (`sync`); demon
 * har redan allt in-process så där behövs ingen prefetch.
 */

import { useEffect, useRef } from "react";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { trpc } from "@/lib/client/trpc";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { prefetchMatterDocuments, type PrefetchableDoc } from "./prefetch-matter-documents";

export function useEagerCacheMatterDocuments(matterId: MatterId): void {
  const { sync } = useCapabilities();
  const tree = trpc.document.tree.useQuery({ matterId }, { enabled: sync });
  const started = useRef(false);

  useEffect(() => {
    if (!sync || started.current) return;
    const docs = tree.data?.documents as PrefetchableDoc[] | undefined;
    if (!docs || docs.length === 0) return;
    started.current = true;
    void (async () => {
      const [{ createServerDownloadClient }, { loadDocumentBlob }] = await Promise.all([
        import("@/lib/client/backend/server-download-client"),
        import("@/lib/client/backend/load-document-blob"),
      ]);
      const client = createServerDownloadClient();
      await prefetchMatterDocuments(docs, (d) => loadDocumentBlob(client, d));
    })();
  }, [sync, matterId, tree.data]);
}
