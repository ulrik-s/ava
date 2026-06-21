"use client";

/**
 * `openMatterDocument` (#651) — öppna ett dokument med RUNTIME-tier-beslut
 * (ej bygg-tids-`NEXT_PUBLIC_DEMO_BUILD`, som är sant även i den lokala
 * self-hosted-builden → länkade fel till GH Pages).
 *
 *   - demo (ingen server): öppna mot GH Pages-URL:en (bundlade blobbar).
 *   - self-hosted (server finns): hämta bytes via serverns
 *     `document.downloadContent` (GitContentStore) + cacha i IndexedDB
 *     (`loadDocumentBlob`) → blob:-URL. Saknas i cachen → populeras först.
 *
 * FSA-lokal kopia (nyligen uppladdad) provas före nätet i båda lägena.
 */

import { loadFirmaConfig } from "@/lib/client/firma/firma-config";

export type OpenableDoc = { id: string; storagePath?: string | null; fileName?: string };

export async function openMatterDocument(doc: OpenableDoc): Promise<void> {
  const { openDocument } = await import("./open-document");
  const { loadHandle } = await import("@/lib/client/fsa/handle-store");
  const { readFromFsa } = await import("@/lib/client/fsa/read-from-fsa");
  const isDemo = loadFirmaConfig().tier === "demo";

  let fetchBlob: (() => Promise<Blob | null>) | undefined;
  if (!isDemo) {
    const { createServerDownloadClient } = await import("@/lib/client/backend/server-download-client");
    const { loadDocumentBlob } = await import("@/lib/client/backend/load-document-blob");
    const client = createServerDownloadClient();
    fetchBlob = () => loadDocumentBlob(client, { id: doc.id, storagePath: doc.storagePath ?? null, fileName: doc.fileName ?? doc.id });
  }

  await openDocument({
    doc,
    isDemo,
    ...(process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO ? { demoRepo: process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO } : {}),
    loadHandle: () => loadHandle("repo-root"),
    readFromHandle: readFromFsa,
    ...(fetchBlob ? { fetchBlob } : {}),
    openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
    notifyError: (m) => { if (typeof window !== "undefined") window.alert(m); },
  });
}
