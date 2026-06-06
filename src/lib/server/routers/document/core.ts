/**
 * Kärn-CRUD för dokument: list, tree, search, delete, analyze, updateMetadata.
 * Inga subgrupper eller förslag — bara själva dokumenten.
 */

import { z } from "zod";
import { orgProcedure } from "../../trpc";
import { isJunkFileName } from "@/lib/shared/junk-files";
import { assertDocAccess } from "./shared";
import { omitUndefined } from "@/lib/shared/omit-undefined";

export const coreProcedures = {
  /** Paginerad lista över dokument + mappar i ett visst ärende/folder. */
  list: orgProcedure
    .input(
      z.object({
        matterId: z.string(),
        folderId: z.string().nullable().default(null),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [documents, folders, total] = await Promise.all([
        ctx.dataStore.documents.findMany({
          where: { matterId: input.matterId, folderId: input.folderId },
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          include: { uploadedBy: { select: { name: true } } },
        }),
        ctx.dataStore.documentFolders.findMany({
          where: { matterId: input.matterId, parentId: input.folderId },
          orderBy: { name: "asc" },
          include: { _count: { select: { documents: true, children: true } } },
        }),
        ctx.dataStore.documents.count({
          where: { matterId: input.matterId, folderId: input.folderId },
        }),
      ]);
      return { documents, folders, total, pages: Math.ceil(total / input.pageSize) };
    }),

  /** Komplett träd (alla mappar + dokument) för ett ärende i en query. */
  tree: orgProcedure
    .input(z.object({ matterId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [folders, documents] = await Promise.all([
        ctx.dataStore.documentFolders.findMany({
          where: { matterId: input.matterId },
          orderBy: { name: "asc" },
        }),
        ctx.dataStore.documents.findMany({
          where: { matterId: input.matterId },
          orderBy: { createdAt: "desc" },
          include: { uploadedBy: { select: { name: true } } },
        }),
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
    .query(async ({ ctx }) => {
      const docs = await ctx.dataStore.documents.findMany({
        where: { matter: { organizationId: ctx.orgId } },
        include: { matter: { select: { organizationId: true } } },
      }) as Array<{ documentType?: string | null }>;
      const counts = new Map<string, number>();
      for (const d of docs) {
        if (!d.documentType) continue;
        counts.set(d.documentType, (counts.get(d.documentType) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => a.type.localeCompare(b.type, "sv"));
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.id);
      const doc = await ctx.dataStore.documents.delete({ where: { id: input.id } });
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
      id: z.string(),
      matterId: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      storagePath: z.string(),
      folderId: z.string().nullable().optional(),
      // Valfri AI-analys-metadata + setup-fält (demo-generator/fixtures,
      // ADR 0003). I appens upload-flöde sätts analysen async av `analyze`.
      uploadedById: z.string().optional(),
      version: z.number().int().positive().optional(),
      title: z.string().nullable().optional(),
      documentType: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      analysisStatus: z.enum(["PENDING", "RUNNING", "DONE", "ERROR"]).optional(),
      analyzedAt: z.string().optional(),
      createdAt: z.string().optional(),
      /** Koppla dokumentet till en faktura (t.ex. genererad faktura/underlag). */
      invoiceId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verifiera matter:n tillhör org:n
      await ctx.dataStore.matters.findFirstOrThrow({
        where: { id: input.matterId, organizationId: ctx.orgId },
      });
      const doc = await ctx.dataStore.documents.create({
        data: {
          id: input.id,
          matterId: input.matterId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          fileSize: input.sizeBytes, // denormaliserat (UI läser fileSize)
          storagePath: input.storagePath,
          folderId: input.folderId ?? null,
          organizationId: ctx.orgId,
          analysisStatus: input.analysisStatus ?? "PENDING",
          uploadedById: input.uploadedById ?? ctx.user.id,
          version: input.version,
          title: input.title,
          documentType: input.documentType,
          summary: input.summary,
          analyzedAt: input.analyzedAt ? new Date(input.analyzedAt) : undefined,
          createdAt: input.createdAt ? new Date(input.createdAt) : undefined,
          invoiceId: input.invoiceId ?? undefined,
        } as never,
      });
      return doc;
    }),

  /** Kör (eller kör om) AI-analys på ett dokument. Returnerar omedelbart. */
  analyze: orgProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      // Fire-and-forget — användaren får svar direkt; UI pollar för resultat.
      ctx.ports.documentAnalyzer.analyze(input.documentId).catch((e: unknown) =>
        console.error("analyze failed:", e),
      );
      return { ok: true };
    }),

  /**
   * Skriv AI-genererad metadata (eller manuell override). Accepterar
   * även `analyzedAt` + `analysisStatus` så client-side workers kan
   * markera dokumentet som färdiganalyserat.
   */
  updateMetadata: orgProcedure
    .input(
      z.object({
        documentId: z.string(),
        title: z.string().nullable().optional(),
        documentType: z.string().nullable().optional(),
        summary: z.string().nullable().optional(),
        analyzedAt: z.union([z.string(), z.date()]).nullable().optional(),
        analysisStatus: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      const { documentId, analyzedAt, analysisStatus, ...rest } = input;
      const data = {
        ...rest,
        ...omitUndefined({
          analysisStatus:
            analysisStatus === undefined
              ? undefined
              : (analysisStatus as "PENDING" | "RUNNING" | "DONE" | "ERROR" | null),
          analyzedAt:
            analyzedAt === undefined
              ? undefined
              : typeof analyzedAt === "string"
                ? new Date(analyzedAt)
                : analyzedAt,
        }),
      };
      return ctx.dataStore.documents.update({ where: { id: documentId }, data });
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
        id: z.string(),
        saves: z.number().int().min(1),
        sessionStartedAt: z.union([z.string(), z.date()]),
        sizeBytes: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.id);
      const doc = await ctx.dataStore.documents.findUniqueOrThrow({ where: { id: input.id } }) as { version?: number };
      return ctx.dataStore.documents.update({
        where: { id: input.id },
        data: {
          version: (doc.version ?? 1) + 1,
          updatedAt: new Date(),
          ...omitUndefined({ sizeBytes: input.sizeBytes, fileSize: input.sizeBytes }),
        },
      });
    }),
};
