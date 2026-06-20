/**
 * `classify-document`-handler (#518) — klassificerar ett uppladdat dokument
 * server-side och skriver tillbaka kategorin på dokumentet.
 *
 * Fas 2: klassificeringen är filnamns-heuristik (`guessFromFilename`) —
 * deterministisk, ingen LLM, ingen modell-nedladdning. Fas 3 injicerar en
 * LLM-backad `classify` (server-LLM via ollama) med samma signatur.
 *
 * Idempotent: kör om → samma kategori skrivs igen (ofarligt). Saknat dokument
 * (raderat innan jobbet kördes) → tyst no-op.
 */

import { z } from "zod";
import { type DocumentKind, guessFromFilename } from "@/lib/shared/document-kind";
import type { Document } from "@/lib/shared/schemas/document";
import type { DocumentRepository } from "../../repositories/document-repository";
import type { JobHandler } from "../job-worker-runtime";

const classifyJobSchema = z.object({
  documentId: z.string(),
  organizationId: z.string().optional(),
});

/** Dokument-fälten klassificeraren behöver (filnamn + var bytes ligger). */
export interface ClassifiableDoc {
  fileName: string;
  storagePath: string;
  mimeType: string;
}

export interface ClassifyDocumentDeps {
  /** Dokument-repo (läs hela raden + skriv tillbaka metadatan UTAN version-bump:
   *  klassificering är metadata, inte en innehållsändring → ADR 0023). */
  documents: Pick<DocumentRepository, "getById" | "updateMetadata">;
  /** Klassificerare; default = filnamns-heuristik. Fas 3 injicerar LLM-varianten. */
  classify?: (doc: ClassifiableDoc) => Promise<DocumentKind>;
  /**
   * Föreslå etiketter ur byråns vokabulär (#621 B2, LLM-väg). Returnerar en
   * delmängd av vokabulären; slås ihop (union) med dokumentets befintliga
   * taggar så manuellt satta taggar ALDRIG skrivs över. Saknas → taggar rörs ej.
   */
  suggestTags?: (doc: ClassifiableDoc) => Promise<string[]>;
  /** Modell-etikett som sparas i `analysisModel`. */
  model?: string;
  /** Injicerbar nu-tid för deterministiska tester. */
  now?: () => Date;
}

export function createClassifyDocumentHandler(deps: ClassifyDocumentDeps): JobHandler {
  const classify = deps.classify ?? (async (doc: ClassifiableDoc) => guessFromFilename(doc.fileName));
  const model = deps.model ?? "filename-heuristic";
  const now = deps.now ?? (() => new Date());

  return async (job): Promise<void> => {
    const { documentId } = classifyJobSchema.parse(job.data);
    const doc = (await deps.documents.getById(documentId)) as Document | null;
    if (!doc) return; // raderat innan jobbet kördes → no-op
    const fields: ClassifiableDoc = { fileName: doc.fileName, storagePath: doc.storagePath, mimeType: doc.mimeType };
    const kind = await classify(fields);
    // LLM-föreslagna taggar slås ihop med befintliga (union) → AI lägger till,
    // användarens manuella taggar bevaras. Utan suggestTags rörs taggarna inte.
    const tagPatch = deps.suggestTags
      ? { tags: [...new Set([...(doc.tags ?? []), ...(await deps.suggestTags(fields))])] }
      : {};
    await deps.documents.updateMetadata(documentId, {
      documentType: kind,
      ...tagPatch,
      analyzedAt: now(),
      analysisStatus: "DONE",
      analysisModel: model,
    });
  };
}
