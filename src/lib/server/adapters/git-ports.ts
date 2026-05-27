/**
 * `buildGitPorts` — `IPorts`-uppsättningen för Git-backenden (local-first).
 *
 * Allt no-op förutom det som faktiskt körs klient-sidigt i git-läget:
 *   - `documentAnalyzer`: enqueue:ar ett classify-jobb.
 *   - `searchIndex`: in-memory full-text-sök direkt mot DemoDataStore.
 *
 * En framtida server-backend (Postgres) wirar sina egna ports (riktig
 * mail-sender, Meilisearch-index, …) i sin `createContext`.
 */

import type { IDataStore } from "../data-store/IDataStore";
import type { IPorts } from "../ports";
import { noopPorts } from "./noop-ports";
import { demoDocumentAnalyzer } from "./demo-document-analyzer";
import { makeDemoSearchIndex } from "./demo-search-index";

export function buildGitPorts(dataStore: IDataStore): IPorts {
  return {
    ...noopPorts,
    documentAnalyzer: demoDocumentAnalyzer,
    searchIndex: makeDemoSearchIndex(dataStore),
  };
}
