/**
 * Job-handler-registret för server-first-runtimen (#504 Fas 3). Bygger
 * `JobHandlers`-kartan som `startJobRuntime` registrerar. En kö får en worker
 * BARA när dess integration är konfigurerad (annars körs kön men konsumeras ej).
 *
 * Idag: e-postutskick (smtp-sender) när AVA_SMTP_* är satt; dokument-
 * klassificering + sidindexering (#518, #1215). Fortnox-sync +
 * regelmotor-handlers slotas in här i takt med att deras config/triggers byggs.
 */

import { preparePdfjsForServer } from "@/lib/server/documents/pdfjs-server-runtime";
import { type SuggestionRepos, writeSuggestionsFromText } from "@/lib/server/documents/suggest-from-text";
import { isEmailDisabled } from "@/lib/server/integrations/email/disabled-email-sender";
import { createSmtpSender, type SmtpConfig } from "@/lib/server/integrations/email/smtp-sender";
import { createOllamaClassifier, createOllamaTagSuggester, type LlmConfig } from "@/lib/server/llm/ollama-classifier";
import type { IContentStore, IDocumentPageIndex } from "@/lib/server/ports";
import { extractPages } from "@/lib/shared/extract-text";
import { createClassifyDocumentHandler, type ClassifyDocumentDeps } from "./handlers/classify-document-handler";
import type { ClassifiableDoc, PageDeps } from "./handlers/document-text";
import { createEmailDispatchHandler } from "./handlers/email-dispatch-handler";
import { createIndexDocumentHandler } from "./handlers/index-document-handler";
import { JOB_QUEUES } from "./job-queue";
import type { JobHandlers } from "./job-worker-runtime";

export interface JobHandlerConfig {
  /** SMTP-konfig för e-postutskick. Saknas → ingen email-worker registreras. */
  smtp?: SmtpConfig;
  /** Dokument-repo för `classify-document`-jobbet (#518). Saknas → ingen classify-worker. */
  documents?: ClassifyDocumentDeps["documents"];
  /** Content-store + LLM-konfig (#518 Fas 3). Båda satta → server-LLM-klassificering
   *  (läs bytes → extrahera text → ollama); annars filnamns-heuristik. */
  content?: IContentStore;
  llm?: LlmConfig;
  /**
   * Repositories för kontakt-/händelseförslag (#988). Satt + content →
   * klassificeringsjobbet skriver också förslag ur dokumentets text. Utan
   * content finns ingen text att läsa server-side → steget hoppas över.
   */
  suggestions?: SuggestionRepos;
  /** Byråns etikett-vokabulär (#621 B2). Satt + content + llm → LLM föreslår
   *  taggar ur listan vid klassificeringen. Lazy så den läses per jobb. */
  vocabulary?: () => Promise<readonly string[]>;
  /** Serverns sidindex (#1215). Satt + content → jobben indexerar sidtexten
   *  och `index-document`-kön får en worker (backfill). */
  pageIndex?: IDocumentPageIndex;
}

/**
 * Läs dokumentets bytes ur content-store:n och extrahera text per sida
 * (PDF/DOCX/text). Tom lista när bytes saknas — anroparen faller tillbaka på
 * filnamnet. Körs EN gång per jobb (#1215); klassificering, taggar och förslag
 * delar resultatet.
 */
function pageReader(content: IContentStore): (doc: ClassifiableDoc) => Promise<string[]> {
  preparePdfjsForServer(); // annars tom PDF-text i den kompilerade binären (#1156)
  return async (doc) => {
    const bytes = await content.read(doc.storagePath);
    return bytes ? await extractPages({ bytes, mimeType: doc.mimeType, fileName: doc.fileName }) : [];
  };
}

/** Sidläsning (kräver content-store) + sidindex (när det finns). */
function buildPages(cfg: JobHandlerConfig): PageDeps {
  if (!cfg.content) return {};
  return { readPages: pageReader(cfg.content), ...(cfg.pageIndex ? { pageIndex: cfg.pageIndex } : {}) };
}

/**
 * Bygg `suggestFromText` för dokumentjobbet (#988): skriv kontakt-/händelse-
 * förslagen ur jobbets text. Kräver content-store (texten) + repositories
 * (skrivningen) — men INTE en LLM: extraktionen är deterministisk, så
 * server-first ger förslag även utan ollama.
 */
function buildSuggest(cfg: JobHandlerConfig): Pick<ClassifyDocumentDeps, "suggestFromText"> {
  const { content, suggestions } = cfg;
  if (!content || !suggestions) return {};
  return {
    suggestFromText: async (documentId, text) => { await writeSuggestionsFromText(suggestions, documentId, text); },
  };
}

/**
 * Bygg `classify` (+ `suggestTags`) för dokumentjobbet. Med content-store +
 * LLM-konfig: klassificera jobbets text via ollama (fail-soft till filnamns-
 * heuristik). Med dessutom en vokabulär (#621 B2): föreslå taggar ur listan.
 * Utan content/llm → handlerns default (heuristik).
 */
function buildClassify(cfg: JobHandlerConfig): Pick<ClassifyDocumentDeps, "classify" | "suggestTags" | "model"> {
  if (!cfg.content || !cfg.llm) return {};
  const ollama = createOllamaClassifier(cfg.llm);
  const tagger = createOllamaTagSuggester(cfg.llm);
  const { vocabulary } = cfg;
  return {
    model: `ollama:${cfg.llm.model}`,
    classify: async (doc, text) => ollama(text, doc.fileName),
    ...(vocabulary ? {
      suggestTags: async (_doc, text) => tagger(text, await vocabulary()),
    } : {}),
  };
}

/** Registrera dokumentjobben: klassificering alltid, indexering när sidor kan läsas + skrivas. */
function registerDocumentHandlers(handlers: JobHandlers, cfg: JobHandlerConfig & Required<Pick<JobHandlerConfig, "documents">>): void {
  const pages = buildPages(cfg);
  handlers[JOB_QUEUES.classifyDocument] = createClassifyDocumentHandler({
    documents: cfg.documents,
    ...pages,
    ...buildClassify(cfg),
    ...buildSuggest(cfg),
  });
  if (pages.readPages && pages.pageIndex) {
    handlers[JOB_QUEUES.indexDocument] = createIndexDocumentHandler({
      documents: cfg.documents, readPages: pages.readPages, pageIndex: pages.pageIndex,
    });
  }
}

/** Bygg handler-kartan ur den tillgängliga integrations-konfigen. */
export function buildServerFirstJobHandlers(cfg: JobHandlerConfig): JobHandlers {
  const handlers: JobHandlers = {};
  if (cfg.smtp) {
    handlers[JOB_QUEUES.emailDispatch] = createEmailDispatchHandler(createSmtpSender(cfg.smtp));
  }
  if (cfg.documents) registerDocumentHandlers(handlers, { ...cfg, documents: cfg.documents });
  return handlers;
}

/**
 * Läs SMTP-konfig ur env (server-first-deployen). Returnerar undefined om någon
 * obligatorisk nyckel saknas → e-postutskick avregistreras tyst (best-effort).
 */
export function loadSmtpConfigFromEnv(env: Record<string, string | undefined> = process.env): SmtpConfig | undefined {
  const host = env.AVA_SMTP_HOST;
  const port = env.AVA_SMTP_PORT;
  const user = env.AVA_SMTP_USER;
  const pass = env.AVA_SMTP_PASS;
  const from = env.AVA_SMTP_FROM;
  if (!host || !port || !user || !pass || !from) return undefined;
  const cfg: SmtpConfig = { host, port: Number(port), user, pass, from };
  return env.AVA_SMTP_SECURE ? { ...cfg, secure: env.AVA_SMTP_SECURE === "true" } : cfg;
}

/**
 * SMTP-konfigen server-first faktiskt använder: `AVA_EMAIL_DISABLED=1` vinner
 * över allt — då registreras ingen utskicks-handler ens om SMTP är konfigurerat.
 */
export function loadActiveSmtpConfig(env: Record<string, string | undefined> = process.env): SmtpConfig | undefined {
  return isEmailDisabled(env) ? undefined : loadSmtpConfigFromEnv(env);
}
