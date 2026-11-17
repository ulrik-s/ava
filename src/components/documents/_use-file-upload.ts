"use client";

/**
 * Uppladdningen i dokumentvyn: optimistiska placeholder-rader, FSA-write eller
 * server-first-bytes, tRPC-register, invalidate och bakgrundsjobb
 * (klassificering + text-extraktion). Utbruten ur `document-browser.tsx` (#1614)
 * så att samma väg kan ta emot målmapp och visningsnamn från namnrutan.
 */

import type { inferRouterInputs } from "@trpc/server";
import { useRef, useState } from "react";
import type { SuggestClient } from "@/lib/client/backend/suggest-from-bytes";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { shouldClassifyOnClient } from "@/lib/client/jobs/classify-policy";
import { enqueueTextExtraction } from "@/lib/client/jobs/enqueue-text-extraction";
import { trpc } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";
import { cleanFileName } from "@/lib/shared/document-file-name";
import { asId, type DocumentFolderId, type MatterId } from "@/lib/shared/schemas/ids";
import type { DocumentRecord } from "./_document-row";

/** Indata till `document.register`. */
export type RegisterInput = inferRouterInputs<AppRouter>["document"]["register"];

/** Valfritt mål och namn för en uppladdad fil. Utan dem: roten och filens eget namn. */
export interface UploadOptions {
  folderId?: DocumentFolderId | null;
  /** Önskat visningsnamn; städas med `cleanFileName` så att filändelsen behålls. */
  fileName?: string;
}

interface UploadResult { id: string; fileName: string; mimeType: string; sizeBytes: number; storagePath: string }

/** Det namn dokumentet sparas med: det valda (städat) eller filens eget. */
export function savedFileName(file: File, fileName?: string): string {
  return (fileName === undefined ? null : cleanFileName(fileName, file.name)) ?? file.name;
}

/**
 * Lös var bytes hamnar: FSA (lokal working copy om ansluten) eller server-first
 * (#518) — generera id + läs bytes som laddas upp content-adresserat efter
 * register. `serverBytes` är null i FSA-fallet.
 */
async function resolveUpload(file: File, matterId: MatterId): Promise<{ result: UploadResult; serverBytes: Uint8Array | null }> {
  const { isFsaSupported, loadHandle } = await import("@/lib/client/fsa/handle-store");
  const handle = isFsaSupported() ? await loadHandle("repo-root") : null;
  if (handle) {
    const { uploadDocumentToFsa } = await import("@/lib/client/fsa/upload-document");
    return { result: await uploadDocumentToFsa({ handle, matterId, file }), serverBytes: null };
  }
  const { uuidv7 } = await import("@/lib/shared/uuid");
  const id = uuidv7();
  return {
    result: {
      id, fileName: file.name, mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size, storagePath: `documents/content/pending-${id}`,
    },
    serverBytes: new Uint8Array(await file.arrayBuffer()),
  };
}

/**
 * Best-effort-förslag ur just uppladdade bytes (#988). Uppladdningen är redan
 * klar när det här körs — ett fel här loggas, det kastas aldrig vidare.
 */
async function suggestFromUpload(client: SuggestClient, doc: UploadResult, bytes: Uint8Array): Promise<void> {
  try {
    const { suggestFromBytes } = await import("@/lib/client/backend/suggest-from-bytes");
    await suggestFromBytes(client, asId<"DocumentId">(doc.id), {
      bytes, mimeType: doc.mimeType, fileName: doc.fileName,
    });
  } catch (err) {
    console.warn("[suggest-from-text] misslyckades:", err);
  }
}

/**
 * Bygger en placeholder-DocumentRecord för optimistisk rendering medan
 * filen håller på att skrivas till FSA + registreras via tRPC.
 * Fälten är "best-effort" — version/uploadedBy/etc bara stub-värden
 * eftersom raden ändå är disabled tills den ersätts av den riktiga.
 */
export function makePlaceholderDoc({
  id, file, matterId, fileName = file.name, folderId = null,
}: { id: string; file: File; matterId: MatterId; fileName?: string; folderId?: DocumentFolderId | null }): DocumentRecord {
  return {
    id: asId<"DocumentId">(id),
    fileName,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    storagePath: "",
    version: 1,
    matterId,
    folderId,
    uploadedById: asId<"UserId">(""),
    createdAt: new Date().toISOString(),
    uploadedBy: { name: null },
    title: null,
    kinds: [],
    kindsManual: false,
    documentType: null,
    summary: null,
    analyzedAt: null,
    analysisError: null,
  };
}

/** Felraden för en fil i felbannern. */
function uploadErrorLine(file: File, err: unknown): string {
  return `${file.name}: ${err instanceof Error ? err.message : String(err)}`;
}

/** Lägger nya felrader under de som redan visas i bannern. */
function appendErrors(prev: string | null, errors: readonly string[]): string {
  return [prev, ...errors].filter((line): line is string => Boolean(line)).join("\n");
}

/** Placeholder-raderna medan en uppladdning pågår. */
function usePendingUploads() {
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [pendingUploads, setPendingUploads] = useState<DocumentRecord[]>([]);
  const add = (doc: DocumentRecord) => {
    setPendingUploads((p) => [...p, doc]);
    setUploadingIds((s) => new Set(s).add(doc.id));
  };
  const remove = (id: string) => {
    setPendingUploads((p) => p.filter((d) => d.id !== id));
    setUploadingIds((s) => { const next = new Set(s); next.delete(id); return next; });
  };
  /** Byt placeholder-id mot riktigt id så raden inte hoppar. */
  const rename = (from: string, to: string) => {
    setUploadingIds((s) => { const next = new Set(s); next.delete(from); next.add(to); return next; });
    setPendingUploads((p) => p.map((d) => (d.id === from ? { ...d, id: asId<"DocumentId">(to) } : d)));
  };
  return { uploadingIds, pendingUploads, add, remove, rename };
}

/**
 * Uppladdnings-state + handlers. `handleFileUpload` är **+ Ladda upp**;
 * `enqueueUpload` tar en fil med målmapp och namn (namnrutan) och köar den
 * efter de uppladdningar som redan pågår.
 */
export function useFileUpload({ matterId, mutations, fileInputRef }: {
  matterId: MatterId;
  mutations: { createFromFsa: (input: RegisterInput) => Promise<void> };
  /** Filväljaren bakom **+ Ladda upp**; nollställs efter varje val. */
  fileInputRef: { readonly current: { value: string } | null };
}) {
  const utils = trpc.useUtils();
  const { jobs } = useCapabilities();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const pending = usePendingUploads();
  const chain = useRef<Promise<void>>(Promise.resolve());

  /** Register + bytes; placeholder-raden tas bort när trädet hämtats om. */
  async function registerUpload(doc: UploadResult, folderId: DocumentFolderId | null, serverBytes: Uint8Array | null): Promise<void> {
    try {
      await mutations.createFromFsa({ ...doc, matterId, ...(folderId ? { folderId } : {}) });
      // Server-first: ladda upp bytes (content-adresserat) efter att metadatan
      // registrerats → repekar storagePath + triggar server-klassificering.
      if (serverBytes) {
        const { saveDocumentContent } = await import("@/lib/client/backend/save-document-content");
        await saveDocumentContent(utils.client, asId<"DocumentId">(doc.id), serverBytes);
      }
    } finally {
      await utils.document.tree.invalidate({ matterId });
      pending.remove(doc.id);
    }
  }

  /** Bakgrundsjobb: klassificering + text-extraktion → sökbart innehåll. */
  async function startBackgroundJobs(doc: UploadResult, serverBytes: Uint8Array | null): Promise<void> {
    // Server-first äger klassificeringen när bytes:en nått servern (#1220) —
    // annars skrev klientens filnamnsgissning över serverns svar.
    if (shouldClassifyOnClient(jobs, serverBytes !== null)) {
      const { jobQueue } = await import("@/lib/client/jobs/job-queue");
      jobQueue.enqueue("classify-document", `Analyserar ${doc.fileName}`, {
        documentId: doc.id, fileName: doc.fileName, storagePath: doc.storagePath,
      });
    }
    await enqueueTextExtraction(doc);
    // Utan working copy (demon, server-first i browsern) kan extract-text-
    // jobbet aldrig läsa filen igen — bytes:en finns bara här. Extrahera nu
    // så kontakt-/händelseförslagen uppstår även där (#988). Best-effort.
    if (serverBytes) void suggestFromUpload(utils.client, doc, serverBytes);
  }

  /** En fil: placeholder → register → bytes → bakgrundsjobb. Kastar vid fel. */
  async function uploadOne(file: File, options: UploadOptions = {}): Promise<void> {
    const fileName = savedFileName(file, options.fileName);
    const folderId = options.folderId ?? null;
    // Optimistisk rad — användaren ser filen direkt i rätt mapp, greyed.
    const placeholderId = `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    pending.add(makePlaceholderDoc({ id: placeholderId, file, matterId, fileName, folderId }));
    try {
      const { result, serverBytes } = await resolveUpload(file, matterId);
      // Det valda namnet gäller även i FSA-grenen (där result.fileName = file.name).
      const doc = { ...result, fileName };
      pending.rename(placeholderId, doc.id);
      await registerUpload(doc, folderId, serverBytes);
      await startBackgroundJobs(doc, serverBytes);
    } catch (err) {
      pending.remove(placeholderId);
      throw err;
    }
  }

  /**
   * Filerna EN I TAGET: parallellt hade tRPC:s batch-länk packat allihop i en
   * enda jättestor request. En fil som fallerar stoppar inte de andra — felen
   * samlas per fil i felbannern.
   */
  async function uploadEach(items: ReadonlyArray<{ file: File; options?: UploadOptions }>): Promise<void> {
    setUploading(true);
    const errors: string[] = [];
    try {
      for (const { file, options } of items) {
        try {
          await uploadOne(file, options);
        } catch (err) {
          console.error("[upload]", err);
          errors.push(uploadErrorLine(file, err));
        }
      }
    } finally {
      setUploading(false);
    }
    if (errors.length > 0) setUploadError((prev) => appendErrors(prev, errors));
  }

  /** **+ Ladda upp**: alla valda filer, i roten med sina egna namn. */
  async function handleFileUpload(e: { target: { files: ArrayLike<File> | null } }): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadError(null);
    try {
      await uploadEach(files.map((file) => ({ file })));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** En fil från namnrutan; körs efter de uppladdningar som redan köats. */
  function enqueueUpload(file: File, options: UploadOptions): Promise<void> {
    chain.current = chain.current.then(() => uploadEach([{ file, options }]));
    return chain.current;
  }

  return {
    uploading, uploadingIds: pending.uploadingIds, pendingUploads: pending.pendingUploads,
    uploadError, setUploadError, handleFileUpload, enqueueUpload,
  };
}
