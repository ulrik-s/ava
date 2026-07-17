/**
 * Kärn-CRUD för dokument: list, tree, search, delete, analyze, updateMetadata.
 * Inga subgrupper eller förslag — bara själva dokumenten.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { conflictCopyName } from "@/lib/shared/conflict-copy";
import { base64ToBytes, bytesToBase64, contentStoragePath, sha256Hex } from "@/lib/shared/content-address";
import { isJunkFileName } from "@/lib/shared/junk-files";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { documentAnalysisStatusSchema, documentDirectionSchema, documentRecipientSchema, type Document } from "@/lib/shared/schemas/document";
import { asId, documentFolderIdSchema, documentIdSchema, invoiceIdSchema, matterIdSchema, userIdSchema } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { orgProcedure } from "../../trpc";
import { assertDocAccess } from "./shared";

export const coreProcedures = {
  /** Paginerad lista över dokument + mappar i ett visst ärende/folder. */
  list: orgProcedure
    .input(
      z.object({
        matterId: matterIdSchema,
        folderId: documentFolderIdSchema.nullable().default(null),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [docs, folders] = await Promise.all([
        ctx.repos.documents.listInFolder(input.matterId, input.folderId, input.page, input.pageSize),
        ctx.repos.documentFolders.listInParent(input.matterId, input.folderId),
      ]);
      const { documents, total } = docs;
      return { documents, folders, total, pages: Math.ceil(total / input.pageSize) };
    }),

  /** Komplett träd (alla mappar + dokument) för ett ärende i en query. */
  tree: orgProcedure
    .input(z.object({ matterId: matterIdSchema }))
    .query(async ({ ctx, input }) => {
      const [folders, documents] = await Promise.all([
        ctx.repos.documentFolders.listByMatter(input.matterId),
        ctx.repos.documents.listByMatter(input.matterId),
      ]);
      // Defense-in-depth: gömmer OS-metadata-sidecars (AppleDouble ._*,
      // .DS_Store etc.) som kan ligga kvar från tidigare uploads.
      const visibleDocs = documents.filter((d) => !isJunkFileName(d.fileName));
      return { folders, documents: visibleDocs };
    }),

  /** Meilisearch-baserad full-text-sök inom org. */
  search: orgProcedure
    .input(z.object({
      query: z.string().min(1),
      limit: z.number().min(1).max(50).default(20),
      documentTypes: z.array(z.string()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.ports.searchIndex.search(
        input.query, ctx.orgId, input.limit,
        omitUndefined({ documentTypes: input.documentTypes }),
      );
      return {
        hits: result.hits.map((hit) => ({
          documentId: hit.id,
          fileName: hit.fileName,
          storagePath: hit.storagePath ?? null,
          matterId: hit.matterId,
          matterNumber: hit.matterNumber,
          matterTitle: hit.matterTitle,
          highlight: hit._formatted?.content || "",
        })),
        totalHits: result.estimatedTotalHits,
        // Per-type-räknare baserat på query-match (oavsett type-filter)
        facets: result.facets ?? { documentTypes: [] },
      };
    }),

  /** Lista alla unika documentType-värden inom org + antal per typ.
   *  Används av sök-sidan för att rendera filter-checkboxar. */
  listDocumentTypes: orgProcedure
    .query(({ ctx }) => ctx.repos.documents.listDocumentTypesForOrg(ctx.orgId)),

  delete: orgProcedure
    .input(z.object({ id: documentIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const doc = await assertDocAccess(ctx, input.id);
      await ctx.repos.documents.hardDelete(input.id);
      ctx.ports.searchIndex.remove(input.id).catch(() => {});
      return doc;
    }),

  /**
   * Registrera ett uppladdat dokument. Används av web-FSA-klienten
   * efter att filen skrivits till lokal disk via uploadDocumentToFsa.
   * I full server-build:n körs uploaden via /api/documents/upload
   * som direkt skriver till Postgres + storage, så denna procedure
   * är bara aktuell för demo/FSA-flödet.
   */
  register: orgProcedure
    .input(z.object({
      id: documentIdSchema,
      matterId: matterIdSchema,
      fileName: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      storagePath: z.string(),
      folderId: documentFolderIdSchema.nullable().optional(),
      // Valfri AI-analys-metadata + setup-fält (demo-generator/fixtures,
      // ADR 0003). I appens upload-flöde sätts analysen async av `analyze`.
      uploadedById: userIdSchema.optional(),
      version: z.number().int().positive().optional(),
      title: z.string().nullable().optional(),
      documentType: z.string().nullable().optional(),
      direction: documentDirectionSchema.nullable().optional(),
      recipient: documentRecipientSchema.nullable().optional(),
      summary: z.string().nullable().optional(),
      analysisStatus: documentAnalysisStatusSchema.optional(),
      analyzedAt: z.string().optional(),
      createdAt: z.string().optional(),
      /** Koppla dokumentet till en faktura (t.ex. genererad faktura/underlag). */
      invoiceId: invoiceIdSchema.nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verifiera matter:n tillhör org:n
      const matter = await ctx.repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
      const data = omitUndefined({
        id: asId<"DocumentId">(input.id),
        matterId: asId<"MatterId">(input.matterId),
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storagePath: input.storagePath,
        folderId: input.folderId ? asId<"DocumentFolderId">(input.folderId) : null,
        organizationId: ctx.orgId,
        analysisStatus: input.analysisStatus ?? "PENDING",
        uploadedById: asId<"UserId">(input.uploadedById ?? ctx.user.id),
        version: input.version,
        title: input.title,
        documentType: input.documentType,
        direction: input.direction,
        recipient: input.recipient,
        summary: input.summary,
        analyzedAt: input.analyzedAt ? new Date(input.analyzedAt) : undefined,
        createdAt: input.createdAt ? new Date(input.createdAt) : undefined,
        invoiceId: input.invoiceId ?? undefined,
      });
      return ctx.repos.documents.create(data);
    }),

  /** Kör (eller kör om) AI-analys på ett dokument. Returnerar omedelbart. */
  analyze: orgProcedure
    .input(z.object({ documentId: documentIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      // Fire-and-forget — användaren får svar direkt; UI pollar för resultat.
      ctx.ports.documentAnalyzer.analyze(input.documentId).catch((e: unknown) =>
        console.error("analyze failed:", e),
      );
      return { ok: true };
    }),

  /**
   * `uploadContent` (#518, ADR 0023) — ta emot dokument-bytes (base64) och
   * lagra dem INNEHÅLLS-ADRESSERAT (sha256). Repekar dokumentets `storagePath`
   * till den nya hashen → ny immutabel version (repo.update bumpar `version`
   * automatiskt, reconcile-konvention). Nytt innehåll → klassificera om
   * (analysen körs server-side via jobb-kön). Gamla bytes behålls (git-historik).
   */
  uploadContent: orgProcedure
    .input(z.object({
      documentId: documentIdSchema,
      contentBase64: z.string(),
      /**
       * Optimistisk version (ADR 0033 §1): versionen klienten redigerade från.
       * Har servern gått förbi → 409, skriv ALDRIG över tyst. Utelämnad →
       * ingen kontroll (bakåtkompatibelt; demo/FSA bär ingen basversion).
       */
      baseVersion: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      // 409 vid versions-drift: bara `version` flyttas av äkta innehållsskrivningar
      // (uploadContent/markExternallyEdited); metadata/analys går via updateMetadata
      // som inte bumpar → inga falska konflikter.
      if (input.baseVersion !== undefined) {
        const current = (await ctx.repos.documents.getById(input.documentId)) as Document | null;
        if (current && current.version !== input.baseVersion) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Dokumentet ändrades av någon annan (server v${current.version}, du redigerade v${input.baseVersion}).`,
          });
        }
      }
      const bytes = base64ToBytes(input.contentBase64);
      const storagePath = contentStoragePath(await sha256Hex(bytes));
      await ctx.ports.content.write(storagePath, bytes);
      const updated = await ctx.repos.documents.update(input.documentId, {
        storagePath,
        sizeBytes: bytes.byteLength,
        analysisStatus: "PENDING",
      });
      ctx.ports.documentAnalyzer.analyze(input.documentId).catch((e: unknown) =>
        console.error("classify after upload failed:", e),
      );
      return updated;
    }),

  /**
   * `downloadContent` (#518, ADR 0023) — läs tillbaka dokument-bytes (base64)
   * från content-store:n via dokumentets `storagePath`. Klienten cachar
   * resultatet innehålls-adresserat (immutabelt → cacha för evigt).
   */
  downloadContent: orgProcedure
    .input(z.object({ documentId: documentIdSchema }))
    .query(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      const doc = (await ctx.repos.documents.getById(input.documentId)) as Document | null;
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      const bytes = await ctx.ports.content.read(doc.storagePath);
      if (!bytes) throw new TRPCError({ code: "NOT_FOUND", message: "Innehåll saknas på servern." });
      // `version` = basversion klienten bär in i uploadContent (ADR 0033 §1).
      return { contentBase64: bytesToBase64(bytes), mimeType: doc.mimeType, fileName: doc.fileName, version: doc.version };
    }),

  /**
   * `saveConflictCopy` (ADR 0033 §4 — keep-both) — när uploadContent 409:at
   * (server gått förbi) sparas användarens version som ett SYSKON-dokument
   * bredvid originalet: inget skrivs över, inget förloras. Nytt dokument i samma
   * ärende/mapp, namn `Original (din ändring <label>).ext`, pekar på de
   * uppladdade bytsen (innehålls-adresserat). Returnerar kopian.
   */
  saveConflictCopy: orgProcedure
    .input(z.object({
      documentId: documentIdSchema,
      contentBase64: z.string(),
      /** Lokal tidsstämpel-etikett för kopians namn (klienten kan lokal tid). */
      label: z.string().min(1).max(40),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      const original = (await ctx.repos.documents.getById(input.documentId)) as Document | null;
      if (!original) throw new TRPCError({ code: "NOT_FOUND" });
      const bytes = base64ToBytes(input.contentBase64);
      const storagePath = contentStoragePath(await sha256Hex(bytes));
      await ctx.ports.content.write(storagePath, bytes);
      const copy = await ctx.repos.documents.create(omitUndefined({
        id: asId<"DocumentId">(uuidv7()),
        matterId: asId<"MatterId">(original.matterId),
        fileName: conflictCopyName(original.fileName, input.label),
        mimeType: original.mimeType,
        sizeBytes: bytes.byteLength,
        storagePath,
        folderId: original.folderId ?? null,
        organizationId: ctx.orgId,
        analysisStatus: "PENDING" as const,
        uploadedById: asId<"UserId">(ctx.user.id),
      }));
      ctx.ports.documentAnalyzer.analyze(copy.id).catch((e: unknown) =>
        console.error("classify after conflict-copy failed:", e),
      );
      return copy;
    }),

  /**
   * `missingContent` (#518, ADR 0023) — vilka content-adresserade sökvägar
   * saknar servern? Byte-synken frågar detta vid reconnect och laddar bara
   * upp blobbar servern inte redan har (dedup på sha).
   */
  missingContent: orgProcedure
    .input(z.object({ storagePaths: z.array(z.string()).max(500) }))
    .query(async ({ ctx, input }) => {
      const checks = await Promise.all(
        input.storagePaths.map(async (p) => ({ p, has: await ctx.ports.content.exists(p) })),
      );
      return { missing: checks.filter((c) => !c.has).map((c) => c.p) };
    }),

  /**
   * Skriv AI-genererad metadata (eller manuell override). Accepterar
   * även `analyzedAt` + `analysisStatus` så client-side workers kan
   * markera dokumentet som färdiganalyserat.
   */
  updateMetadata: orgProcedure
    .input(
      z.object({
        documentId: documentIdSchema,
        title: z.string().nullable().optional(),
        documentType: z.string().nullable().optional(),
        summary: z.string().nullable().optional(),
        analyzedAt: z.union([z.string(), z.date()]).nullable().optional(),
        analysisStatus: documentAnalysisStatusSchema.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      const { documentId, analyzedAt, analysisStatus, ...rest } = input;
      const data = {
        ...rest,
        ...omitUndefined({
          analysisStatus,
          analyzedAt:
            analyzedAt === undefined
              ? undefined
              : typeof analyzedAt === "string"
                ? new Date(analyzedAt)
                : analyzedAt,
        }),
      };
      // Metadata-skrivning (titel/typ/summary/analys-status) → INTE en
      // innehållsändring, så versionen bumpas inte (ADR 0023). Innehållsändringar
      // går via uploadContent/markExternallyEdited som bumpar versionen.
      return ctx.repos.documents.updateMetadata(documentId, data);
    }),

  /**
   * `setTags` (#621) — sätt dokumentets etiketter. Validerar att alla taggar
   * finns i byråns vokabulär (`organization.documentTags`) så listan hålls
   * konsekvent. Etiketter är metadata → bumpar INTE versionen (#619).
   */
  setTags: orgProcedure
    .input(z.object({ documentId: documentIdSchema, tags: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      const org = await ctx.repos.organizations.getById(ctx.orgId);
      const vocab = new Set(org?.documentTags ?? []);
      const invalid = input.tags.filter((t) => !vocab.has(t));
      if (invalid.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Okända etiketter: ${invalid.join(", ")}` });
      }
      // Dedup, behåll inmatningsordning.
      const tags = [...new Set(input.tags)];
      return ctx.repos.documents.updateMetadata(input.documentId, { tags });
    }),

  /**
   * `markExternallyEdited` — kallas av `ExternalEditTracker` när user
   * har sparat ändringar i en extern editor (PDF Gear, Word, etc.).
   * Bumpar version + updatedAt + sizeBytes så manifest + commit-pipeline
   * picks up ändringen. Faktiska bytes ligger redan på rätt path i FSA-
   * mappen (extern editor sparade in-place).
   */
  markExternallyEdited: orgProcedure
    .input(
      z.object({
        id: documentIdSchema,
        saves: z.number().int().min(1),
        sessionStartedAt: z.union([z.string(), z.date()]),
        sizeBytes: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.id);
      // repo.update bumpar version + updatedAt automatiskt (reconcile-konvention).
      return ctx.repos.documents.update(
        input.id,
        omitUndefined({ sizeBytes: input.sizeBytes }),
      );
    }),
};
