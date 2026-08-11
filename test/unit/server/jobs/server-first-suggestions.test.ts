/**
 * Server-first-tier:ns väg till kontakt- och händelseförslag (#988).
 *
 * `writeSuggestionsFromText` testas för sig; det här testet påstår att
 * `classify-document`-jobbet faktiskt NÅR den — hela vägen från
 * `buildServerFirstJobHandlers` via content-store:n och textextraktionen.
 * Det var precis den kopplingen som saknades: producenten fanns, men ingen
 * runtime kallade den.
 *
 * Noterbart: förslagen kräver INTE en LLM. Extraktionen är deterministisk, så
 * en server-first-deploy utan ollama får dem ändå — bara content-store:n måste
 * finnas (annars finns ingen text att läsa server-side).
 */

import type { Job } from "pg-boss";
import { describe, it, expect } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import type { SuggestionRepos } from "@/lib/server/documents/suggest-from-text";
import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { buildServerFirstJobHandlers } from "@/lib/server/jobs/server-first-handlers";
import type { IContentStore } from "@/lib/server/ports";
import { InMemoryDocumentSuggestionRepository } from "@/lib/server/repositories/in-memory-document-suggestion-repository";
import { InMemoryMatterEventSuggestionRepository } from "@/lib/server/repositories/in-memory-matter-event-suggestion-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";

const ORG = asId<"OrganizationId">("77777777-7777-7777-8777-777777777777");
const STORAGE_PATH = "documents/content/stamning.txt";

const TEXT = [
  "STÄMNINGSANSÖKAN",
  "Kärande: Anna Andersson 850312-4567",
  "Svarande: Byggfirma Stenhammar AB 556677-8899",
  "",
  "Muntlig förberedelse har satts ut till 2026-09-15 kl. 09.30.",
].join("\n");

/** Content-store som bara kan svara på ett dokument — resten saknas. */
function contentWith(bytes: Uint8Array | null): IContentStore {
  return {
    write: async () => {},
    read: async (path) => (path === STORAGE_PATH ? bytes : null),
    exists: async (path) => path === STORAGE_PATH && bytes !== null,
  };
}

function setup() {
  const matterId = asId<"MatterId">(uuidv7());
  const documentId = asId<"DocumentId">(uuidv7());
  const source = prebakeJoins({
    matters: [{ id: matterId, organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documents: [{
      id: documentId, matterId, fileName: "stamning.txt",
      storagePath: STORAGE_PATH, mimeType: "text/plain",
    }],
    documentAnalysisSuggestions: [],
    matterEventSuggestions: [],
  } as DemoSource);
  const store = new LocalStore(source, async () => {});
  const suggestions: SuggestionRepos = {
    documentAnalysisSuggestions: new InMemoryDocumentSuggestionRepository(store),
    matterEventSuggestions: new InMemoryMatterEventSuggestionRepository(store),
  };
  // Bara de två metoderna handlern rör; resten av dokument-repo:t behövs inte.
  const documents = {
    getById: async () => ({ id: documentId, fileName: "stamning.txt", storagePath: STORAGE_PATH, mimeType: "text/plain" }),
    updateMetadata: async () => ({}),
  };
  return { documentId, suggestions, documents };
}

/** Ett minimalt pg-boss-jobb — handlern läser bara `data`. */
function jobFor(documentId: string): Job {
  return {
    id: "job-1", name: JOB_QUEUES.classifyDocument, data: { documentId },
    expireInSeconds: 60, heartbeatSeconds: null, signal: AbortSignal.abort(),
  };
}

function runClassify(handlers: ReturnType<typeof buildServerFirstJobHandlers>, documentId: string) {
  const handler = handlers[JOB_QUEUES.classifyDocument];
  if (!handler) throw new Error("ingen classify-handler registrerad");
  return handler(jobFor(documentId));
}

describe("classify-document → kontakt-/händelseförslag (server-first)", () => {
  it("skriver förslag ur dokumentets text, utan LLM", async () => {
    const { documentId, suggestions, documents } = setup();
    const handlers = buildServerFirstJobHandlers({
      documents: documents as never,
      content: contentWith(new TextEncoder().encode(TEXT)),
      suggestions,
    });
    await runClassify(handlers, documentId);

    const parties = await suggestions.documentAnalysisSuggestions.listForDocument(documentId);
    expect(parties.map((p) => p.name).sort()).toEqual(["Anna Andersson", "Byggfirma Stenhammar AB"]);
    const events = await suggestions.matterEventSuggestions.listForDocument(documentId);
    expect(events.map((e) => e.title)).toEqual(["Muntlig förberedelse"]);
  });

  it("omkörning av jobbet ger inga dubbletter", async () => {
    const { documentId, suggestions, documents } = setup();
    const handlers = buildServerFirstJobHandlers({
      documents: documents as never,
      content: contentWith(new TextEncoder().encode(TEXT)),
      suggestions,
    });
    await runClassify(handlers, documentId);
    await runClassify(handlers, documentId);
    expect(await suggestions.documentAnalysisSuggestions.listForDocument(documentId)).toHaveLength(2);
  });

  it("bytes saknas i content-store:n → inga förslag, inget fel", async () => {
    const { documentId, suggestions, documents } = setup();
    const handlers = buildServerFirstJobHandlers({
      documents: documents as never, content: contentWith(null), suggestions,
    });
    await runClassify(handlers, documentId);
    expect(await suggestions.documentAnalysisSuggestions.listForDocument(documentId)).toHaveLength(0);
  });

  it("utan content-store finns ingen text server-side → steget kopplas inte in", async () => {
    const { documentId, suggestions, documents } = setup();
    const handlers = buildServerFirstJobHandlers({ documents: documents as never, suggestions });
    await runClassify(handlers, documentId);
    expect(await suggestions.documentAnalysisSuggestions.listForDocument(documentId)).toHaveLength(0);
  });
});
