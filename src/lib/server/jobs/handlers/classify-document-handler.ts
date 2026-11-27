/**
 * `classify-document`-handler (#518) — klassificerar ett uppladdat dokument
 * server-side och skriver tillbaka dokumentets typer (ADR 0038).
 *
 * Fas 2: klassificeringen är filnamns-heuristik (`guessFromFilename`) —
 * deterministisk, ingen LLM, ingen modell-nedladdning. Fas 3 injicerar en
 * LLM-backad `classify` (server-LLM via ollama) med samma signatur.
 *
 * Med `readPages` + `pageIndex` (#1215) läses dokumentets text EN gång per
 * jobb, indexeras per sida för fulltextsökning och återanvänds av
 * klassificering, typförslag och förslagsskrivning.
 *
 * Med en injicerad `suggestFromText` (#988) skriver jobbet dessutom kontakt-
 * och händelseförslag ur dokumentets text — det är server-first-tier:ns väg in
 * i `SuggestionsPanel`/`EventsPanel`.
 *
 * Typerna (ADR 0038): sidorna segmenteras till DELAR (kallelse + stämning +
 * FUP …) — rubrikheuristik per sida + `classifyPart` (LLM) bara på kandidat-
 * startsidor, med tak. Dokumentets typer blir delarnas typer i sidordning plus
 * de av byråns egna typer som `suggestKinds` föreslår. Har en person eller
 * systemet satt typerna (`kindsAreManual`) rörs varken typerna eller delarna.
 *
 * Idempotent: kör om → samma typer skrivs igen (ofarligt), och
 * förslagsskrivningen dedupar på sitt håll. Saknat dokument (raderat innan
 * jobbet kördes) → tyst no-op.
 */

import { type DocumentKind, guessFromFilename } from "@/lib/shared/document-kind";
import { kindsAreManual, kindsFields } from "@/lib/shared/document-kinds";
import { type PartClassifier, type SegmentOptions, type SegmentPart, segmentPages } from "@/lib/shared/document-segmentation";
import { joinPages } from "@/lib/shared/extract-text";
import type { Document } from "@/lib/shared/schemas/document";
import type { DocumentId } from "@/lib/shared/schemas/ids";
import type { DocumentRepository } from "../../repositories/document-repository";
import type { JobHandler } from "../job-worker-runtime";
import { type PartsRepo, replaceDocumentParts } from "./document-parts-writer";
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
   * LLM-klassificerare för kandidat-startsidor i segmenteringen (#1220).
   * Saknas → bara rubrikheuristik, med `classify` som kategori för sida 1.
   */
  classifyPart?: PartClassifier;
  /** Tak för LLM-anrop per dokument (default i segmenteringen). */
  maxLlmCalls?: number;
  /** Dokumentdel-repo (#1220). Saknas → delar skrivs inte (bara typerna). */
  parts?: PartsRepo;
  /**
   * Föreslå bland byråns egna dokumenttyper (ADR 0038, LLM-väg). Returnerar en
   * delmängd av listan; läggs efter delarnas typer. Saknas → inga egna typer.
   */
  suggestKinds?: (doc: ClassifiableDoc, text: string) => Promise<string[]>;
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

  const segmentOpts = (fallbackKind: DocumentKind): SegmentOptions => ({
    fallbackKind,
    ...(deps.classifyPart ? { classify: deps.classifyPart } : {}),
    ...(deps.maxLlmCalls !== undefined ? { maxLlmCalls: deps.maxLlmCalls } : {}),
  });

  /**
   * Skriver delarna med dokumentet som det ser ut nu: flyttas det till ett
   * annat ärende medan klassningen pågår får delarna det nya ärendet (#2045).
   * Är det borttaget skrivs inga delar.
   */
  async function writeParts(doc: Document, computed: SegmentPart[], pageCount: number): Promise<readonly SegmentPart[]> {
    if (!deps.parts) return computed;
    const current = await deps.documents.getById(doc.id);
    return current ? replaceDocumentParts(deps.parts, current, computed, pageCount) : computed;
  }

  /**
   * Delarnas typer i sidordning. Utan sidor (ingen text) → inga delar, bara
   * klassificerarens typ för hela dokumentet.
   */
  async function partKinds(doc: Document, fields: ClassifiableDoc, pages: string[]): Promise<DocumentKind[]> {
    const fallback = await classify(fields, joinPages(pages));
    if (pages.length === 0) return [fallback];
    const computed = await segmentPages(pages, segmentOpts(fallback));
    const parts = await writeParts(doc, computed, pages.length);
    return parts.length > 0 ? parts.map((p) => p.kind) : [fallback];
  }

  /** Dokumentets typer ur analysen: delarna + byråns egna typer som föreslås. */
  async function autoKinds(doc: Document, fields: ClassifiableDoc, pages: string[], text: string): Promise<string[]> {
    const suggested = deps.suggestKinds ? await deps.suggestKinds(fields, text) : [];
    return [...await partKinds(doc, fields, pages), ...suggested];
  }

  return async (job): Promise<void> => {
    const { documentId } = documentJobSchema.parse(job.data);
    const doc = await deps.documents.getById(documentId);
    if (!doc) return; // raderat innan jobbet kördes → no-op
    const fields = classifiableFields(doc);
    // Sidorna läses EN gång och indexeras (#1215) — även om klassificeringen
    // sedan fallerar är dokumentet sökbart.
    const pages = await readAndIndexPages(deps, documentId, fields);
    const text = joinPages(pages);
    // Typer som en person eller systemet satt skrivs aldrig över (ADR 0038).
    const kinds = kindsAreManual(doc) ? {} : kindsFields(await autoKinds(doc, fields, pages, text), false);
    await deps.documents.updateMetadata(documentId, {
      ...kinds,
      analyzedAt: now(),
      analysisStatus: "DONE",
      analysisModel: model,
    });
    await deps.suggestFromText?.(documentId, text);
  };
}
