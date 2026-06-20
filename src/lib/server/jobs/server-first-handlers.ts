/**
 * Job-handler-registret för server-first-runtimen (#504 Fas 3). Bygger
 * `JobHandlers`-kartan som `startJobRuntime` registrerar. En kö får en worker
 * BARA när dess integration är konfigurerad (annars körs kön men konsumeras ej).
 *
 * Idag: e-postutskick (smtp-sender) när AVA_SMTP_* är satt. Fortnox-sync +
 * regelmotor-handlers slotas in här i takt med att deras config/triggers byggs.
 */

import { createSmtpSender, type SmtpConfig } from "@/lib/server/integrations/email/smtp-sender";
import { createOllamaClassifier, createOllamaTagSuggester, type LlmConfig } from "@/lib/server/llm/ollama-classifier";
import type { IContentStore } from "@/lib/server/ports";
import { extractText } from "@/lib/shared/extract-text";
import { createClassifyDocumentHandler, type ClassifiableDoc, type ClassifyDocumentDeps } from "./handlers/classify-document-handler";
import { createEmailDispatchHandler } from "./handlers/email-dispatch-handler";
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
  /** Byråns etikett-vokabulär (#621 B2). Satt + content + llm → LLM föreslår
   *  taggar ur listan vid klassificeringen. Lazy så den läses per jobb. */
  vocabulary?: () => Promise<readonly string[]>;
}

/**
 * Bygg `classify` (+ `suggestTags`) för dokumentjobbet. Med content-store +
 * LLM-konfig: läs bytes → extrahera text (PDF/DOCX/text) → klassificera via
 * ollama (fail-soft till filnamns-heuristik). Med dessutom en vokabulär (#621
 * B2): föreslå taggar ur listan. Utan content/llm → handlerns default (heuristik).
 */
function buildClassify(cfg: JobHandlerConfig): Pick<ClassifyDocumentDeps, "classify" | "suggestTags" | "model"> {
  if (!cfg.content || !cfg.llm) return {};
  const content = cfg.content;
  const ollama = createOllamaClassifier(cfg.llm);
  const tagger = createOllamaTagSuggester(cfg.llm);
  const { vocabulary } = cfg;
  const textOf = async (doc: ClassifiableDoc): Promise<string> => {
    const bytes = await content.read(doc.storagePath);
    return bytes ? await extractText({ bytes, mimeType: doc.mimeType, fileName: doc.fileName }) : "";
  };
  return {
    model: `ollama:${cfg.llm.model}`,
    classify: async (doc: ClassifiableDoc) => ollama(await textOf(doc), doc.fileName),
    ...(vocabulary ? {
      suggestTags: async (doc: ClassifiableDoc) => tagger(await textOf(doc), await vocabulary()),
    } : {}),
  };
}

/** Bygg handler-kartan ur den tillgängliga integrations-konfigen. */
export function buildServerFirstJobHandlers(cfg: JobHandlerConfig): JobHandlers {
  const handlers: JobHandlers = {};
  if (cfg.smtp) {
    handlers[JOB_QUEUES.emailDispatch] = createEmailDispatchHandler(createSmtpSender(cfg.smtp));
  }
  if (cfg.documents) {
    handlers[JOB_QUEUES.classifyDocument] = createClassifyDocumentHandler({
      documents: cfg.documents,
      ...buildClassify(cfg),
    });
  }
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
