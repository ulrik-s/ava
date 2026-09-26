"use client";

/**
 * Dokumentsökningen per omfång (ADR 0028 §4c, #1215):
 *   - `"server"` — frågar SERVERNS `document.search` direkt (Postgres-fulltext
 *     över sidtexten i alla dokument). Den in-process-routern i webbläsaren
 *     har bara den lokala cachen och inget textindex.
 *   - `"local"`  — demon: in-process-routern skannar cachen.
 *   - `"offline"` — ingen fråga alls (sidan visar en offline-notis).
 */

import { useQuery } from "@tanstack/react-query";
import { serverTrpcClient } from "@/lib/client/backend/server-trpc-client";
import { trpc } from "@/lib/client/trpc";
import type { SearchScope } from "./search-scope";

/** Sökningens indata (samma form som `document.search`). */
export interface DocumentSearchInput {
  query: string;
  documentTypes?: string[];
}

export function useDocumentSearch(input: DocumentSearchInput, scope: SearchScope) {
  const active = input.query.length > 0;
  const local = trpc.document.search.useQuery(input, { enabled: active && scope === "local" });
  const server = useQuery({
    queryKey: ["server", "document.search", input],
    queryFn: () => serverTrpcClient().document.search.query(input),
    enabled: active && scope === "server",
  });
  return scope === "server" ? server : local;
}
