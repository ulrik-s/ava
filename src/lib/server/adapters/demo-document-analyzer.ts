/**
 * `demoDocumentAnalyzer` — IDocumentAnalyzer-port för demo-läget.
 * Istället för noop som tidigare, enqueue:ar den ett classify-document-
 * jobb i den client-side jobb-kön. Workern sköter sedan filename-
 * heuristik (eller WebLLM senare) och skriver tillbaka via
 * document.updateMetadata-tRPC.
 *
 * Anledning: i web/demo finns ingen server-side LLM. "Analysera"-knappen
 * måste fortfarande göra något — så vi routar genom samma client-side
 * pipeline som auto-classify-vid-upload.
 */

import type { DocumentId } from "@/lib/shared/schemas/ids";
import type { IDocumentAnalyzer } from "../ports";

export const demoDocumentAnalyzer: IDocumentAnalyzer = {
  async analyze(documentId: DocumentId): Promise<void> {
    if (typeof window === "undefined") return;
    const { jobQueue } = await import("@/lib/client/jobs/job-queue");
    // Vi vet bara id:t här, inte filnamnet. Workern hämtar fileName via
    // tRPC (document.tree) om den behöver. För nu använder vi id som
    // label så användaren ser något i /jobs.
    jobQueue.enqueue("classify-document", `Analyserar dokument ${documentId.slice(0, 12)}…`, {
      documentId,
      fileName: "",
      storagePath: "",
    });
  },
};
