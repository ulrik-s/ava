/**
 * `classify-document`-handler (#518) — klassificerar ett uppladdat dokument
 * server-side och skriver tillbaka kategorin på dokumentet.
 *
 * Fas 2: klassificeringen är filnamns-heuristik (`guessFromFilename`) —
 * deterministisk, ingen LLM, ingen modell-nedladdning. Fas 3 injicerar en
 * LLM-backad `classify` (server-LLM via ollama) med samma signatur.
 *
 * Med `readPages` + `pageIndex` (#1215) läses dokumentets text EN gång per
 * jobb, indexeras per sida för fulltextsökning och återanvänds av
 * klassificering, taggförslag och förslagsskrivning.
 *
 * Med en injicerad `suggestFromText` (#988) skriver jobbet dessutom kontakt-
 * och händelseförslag ur dokumentets text — det är server-first-tier:ns väg in
 * i `SuggestionsPanel`/`EventsPanel`.
 *
 * Idempotent: kör om → samma kategori skrivs igen (ofarligt), och
 * förslagsskrivningen dedupar på sitt håll. Saknat dokument (raderat innan
 * jobbet kördes) → tyst no-op.
 */

import { type DocumentKind, guessFromFilename } from "@/lib/shared/document-kind";
import { joinPages } from "@/lib/shared/extract-text";
import type { Document } from "@/lib/shared/schemas/document";
import type { DocumentId } from "@/lib/shared/schemas/ids";
import type { DocumentRepository } from "../../repositories/document-repository";
import type { JobHandler } from "../job-worker-runtime";
import { type ClassifiableDoc, classifiableFields, documentJobSchema, type PageDeps, readAndIndexPages } from "./document-text";

export interface ClassifyDocumentDeps extends PageDeps {
  /** Dokument-repo (läs hela raden + skriv tillbaka metadatan UTAN version-bump:
   *  klassificering är metadata, inte en innehållsändring → ADR 0023). */
  documents: Pick<DocumentRepository, "getById" | "updateMetadata">;
  /**
   * Klassificerare; default = filnamns-heuristik. Fas 3 injicerar LLM-varianten.
   * `text` = dokumentets sidor ihopslagna (läst EN gång via `readPages`, #1215);
   * tom sträng när ingen text finns server-side.
   */
  classify?: (doc: ClassifiableDoc, text: string) => Promise<DocumentKind>;
  /**
   * Föreslå etiketter ur byråns vokabulär (#621 B2, LLM-väg). Returnerar en
   * delmängd av vokabulären; slås ihop (union) med dokumentets befintliga
   * taggar så manuellt satta taggar ALDRIG skrivs över. Saknas → taggar rörs ej.
   */
  suggestTags?: (doc: ClassifiableDoc, text: string) => Promise<string[]>;
  /**
   * Skapa kontakt- och händelseförslag ur dokumentets TEXT (#988). Körs EFTER
   * metadata-skrivningen: misslyckas extraktionen får klassificeringen ändå
   * behålla sitt resultat (jobbet är idempotent och kan köras om).
   *
   * Saknas → hoppas över. Så är det i klient-tier:erna, där bytes:en aldrig
   * når servern och texten i stället kommer ur browserns `extract-text`-jobb.
   */
  suggestFromText?: (documentId: DocumentId, text: string) => Promise<void>;
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
    const { documentId } = documentJobSchema.parse(job.data);
    const doc = (await deps.documents.getById(documentId)) as Document | null;
    if (!doc) return; // raderat innan jobbet kördes → no-op
    const fields = classifiableFields(doc);
    // Sidorna läses EN gång och indexeras (#1215) — även om klassificeringen
    // sedan fallerar är dokumentet sökbart.
    const text = joinPages(await readAndIndexPages(deps, documentId, fields));
    const kind = await classify(fields, text);
    // LLM-föreslagna taggar slås ihop med befintliga (union) → AI lägger till,
    // användarens manuella taggar bevaras. Utan suggestTags rörs taggarna inte.
    const tagPatch = deps.suggestTags
      ? { tags: [...new Set([...(doc.tags ?? []), ...(await deps.suggestTags(fields, text))])] }
      : {};
    await deps.documents.updateMetadata(documentId, {
      documentType: kind,
      ...tagPatch,
      analyzedAt: now(),
      analysisStatus: "DONE",
      analysisModel: model,
    });
    await deps.suggestFromText?.(documentId, text);
  };
}
