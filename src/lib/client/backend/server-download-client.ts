"use client";

/**
 * `createServerDownloadClient` (#651) — en tRPC-klient mot den DEPLOYADE servern
 * (`/api/trpc`, samma-origin-cookie via oauth2-proxy) för att hämta
 * dokument-bytes i self-hosted. Den IN-PROCESS-klienten (GitBackendRuntime) har
 * `StaticContentStore` som pekar på GH Pages — fel källa i self-hosted. Här
 * läser `document.downloadContent` serverns GitContentStore (#518), och
 * `loadDocumentBlob` cachar resultatet i IndexedDB (öppna→cache-populering).
 */

import type { DownloadClient } from "./load-document-blob";
import { serverTrpcClient } from "./server-trpc-client";

/** Den deployade serverns tRPC-klient, smalnad till `DownloadClient`-ytan
 *  `loadDocumentBlob` behöver (full klient är strukturellt tilldelningsbar). */
export function createServerDownloadClient(baseUrl?: string): DownloadClient {
  return serverTrpcClient(baseUrl);
}
