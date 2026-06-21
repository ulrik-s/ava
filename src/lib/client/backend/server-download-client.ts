"use client";

/**
 * `createServerDownloadClient` (#651) — en tRPC-klient mot den DEPLOYADE servern
 * (`/api/trpc`, samma-origin-cookie via oauth2-proxy) för att hämta
 * dokument-bytes i self-hosted. Den IN-PROCESS-klienten (GitBackendRuntime) har
 * `StaticContentStore` som pekar på GH Pages — fel källa i self-hosted. Här
 * läser `document.downloadContent` serverns GitContentStore (#518), och
 * `loadDocumentBlob` cachar resultatet i IndexedDB (öppna→cache-populering).
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import { serverTrpcEndpoint } from "./http-backend-runtime";
import type { DownloadClient } from "./load-document-blob";

/** Den deployade serverns tRPC-klient, smalnad till `DownloadClient`-ytan
 *  `loadDocumentBlob` behöver (full klient är strukturellt tilldelningsbar). */
export function createServerDownloadClient(baseUrl?: string): DownloadClient {
  const client = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: serverTrpcEndpoint(baseUrl), transformer: superjson })],
  });
  return client;
}
