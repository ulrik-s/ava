/**
 * Servern klassar ett dokument vars innehåll kom via synken (#1156).
 *
 * I self-hosted körs `uploadContent` i klienten: servern får dokumentets nya
 * `storagePath` i en synkad rad och bytes:en via byte-synken — men bara om den
 * inte redan har dem (dedup på sha). Samma fil uppladdad igen gav därför aldrig
 * någon klassning av servern. Här: en accepterad dokumentrad med ett NYTT
 * innehåll som servern redan har → köa klassificeringen. Saknas bytes:en än
 * gör `uploadContent` det när de kommer.
 */

import type { IContentStore, IDocumentAnalyzer } from "@/lib/server/ports";
import { log } from "@/lib/shared/observability/logger";
import { errorMessage } from "@/lib/shared/observability/redact";
import { asId, type DocumentId } from "@/lib/shared/schemas/ids";
import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { PushResult } from "../data-store/in-memory/sync-transport";

/** Läsningen `storagePathBefore` behöver (`Repositories` uppfyller den). */
export interface DocumentPathReader {
  documents: { getById(id: DocumentId): Promise<{ storagePath: string } | null> };
}

/** Det som behövs för att avgöra och köa. */
export interface ClassifyNewContentDeps {
  content: Pick<IContentStore, "exists">;
  analyzer: IDocumentAnalyzer;
}

const isDocumentWrite = (m: QueuedMutation): boolean => m.entity === "document" && m.kind !== "delete";

/** Dokumentets `storagePath` på servern FÖRE pushen (null = ny rad; undefined = inte ett dokument). */
export async function storagePathBefore(repos: DocumentPathReader, m: QueuedMutation): Promise<string | null | undefined> {
  if (!isDocumentWrite(m) || typeof m.row.id !== "string") return undefined;
  const doc = await repos.documents.getById(asId<"DocumentId">(m.row.id));
  return doc ? doc.storagePath : null;
}

/** Dokument-id + ny `storagePath` om pushen gav dokumentet nytt innehåll, annars null. */
function newContent(m: QueuedMutation, before: string | null | undefined, result: PushResult): { id: string; path: string } | null {
  if (!isDocumentWrite(m) || result.status === "conflict") return null;
  const { id, storagePath } = result.row;
  if (typeof id !== "string" || typeof storagePath !== "string" || storagePath === before) return null;
  return { id, path: storagePath };
}

/** Köa serverns klassificering när pushen gav nytt innehåll som redan finns. Fäller aldrig synken. */
export async function analyzeIfNewContent(
  deps: ClassifyNewContentDeps,
  m: QueuedMutation,
  before: string | null | undefined,
  result: PushResult,
): Promise<void> {
  const next = newContent(m, before, result);
  if (!next) return;
  try {
    if (await deps.content.exists(next.path)) await deps.analyzer.analyze(asId<"DocumentId">(next.id));
  } catch (e) {
    log.error("sync.classify.failed", { message: `${next.id}: ${errorMessage(e)}` });
  }
}
