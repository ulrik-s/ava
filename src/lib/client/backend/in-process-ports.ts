/**
 * `inProcessPorts` — portarna för klientens in-process-tRPC (demo och
 * self-hosted-klientens lokala körning).
 *
 * Dokumentklassificering (#1156): i demon finns ingen server, så klientens
 * jobb klassar (filnamns-heuristik). I self-hosted äger SERVERN
 * klassificeringen — den läser PDF-texten och frågar server-LLM:en. Klientens
 * lokala gissning (utan ens filnamnet) skrev annars över serverns svar när den
 * synkades. Där är den lokala analyzern därför en no-op: uppladdningar klassas
 * av servern när innehållet når den, och "Analysera" köas som ett anrop som
 * servern kör om (`document.analyze` i `QUEUED_PROCEDURES`).
 */

import type { FirmaConfig } from "@/lib/client/firma/firma-config";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { noopDocumentAnalyzer } from "@/lib/server/adapters/noop-ports";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import type { IPorts } from "@/lib/server/ports";
import { demoDataBaseUrl } from "../demo/demo-data-base";
import { StaticContentStore } from "./static-content-store";

/** Portarna för in-process-tRPC:n i den givna tiern. */
export function inProcessPorts(dataStore: IDataStore, firmaConfig: FirmaConfig): IPorts {
  const ports: IPorts = {
    ...buildGitPorts(dataStore),
    // Content-porten serverar de bundlade dokument-blobbarna (#545, ADR 0025) så
    // `document.downloadContent` → byte-cachen funkar i demon, via SAMMA
    // IContentStore-söm som GitContentStore server-side.
    content: new StaticContentStore(demoDataBaseUrl(firmaConfig.repo)),
  };
  return firmaConfig.tier === "self-hosted" ? { ...ports, documentAnalyzer: noopDocumentAnalyzer } : ports;
}
