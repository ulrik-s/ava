/**
 * Folder-CRUD och flytt-operationer för dokumentträdet.
 *
 * Exporteras som ett objekt av procedurer som kompositionen i `document.ts`
 * spreadar in i den flata `documentRouter`. Detta bevarar det externa API:t
 * (`trpc.document.createFolder` etc.) samtidigt som filerna blir små.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DocumentFolder } from "@/lib/shared/schemas/document";
import {
  matterIdSchema,
  documentFolderIdSchema,
  documentIdSchema,
  type DocumentFolderId,
} from "@/lib/shared/schemas/ids";
import { orgProcedure } from "../../trpc";
import { assertMatterAccess } from "./shared";

export const folderProcedures = {
  createFolder: orgProcedure
    .input(
      z.object({
        matterId: matterIdSchema,
        name: z.string().min(1),
        parentId: documentFolderIdSchema.nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterAccess(ctx, input.matterId);
      return ctx.repos.documentFolders.create({
        name: input.name,
        matterId: input.matterId,
        parentId: input.parentId,
      } as Partial<DocumentFolder>);
    }),

  renameFolder: orgProcedure
    .input(z.object({ id: documentFolderIdSchema, name: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.repos.documentFolders.update(input.id, { name: input.name } as Partial<DocumentFolder>),
    ),

  /** Flyttar innehåll till parent och raderar mappen. */
  deleteFolder: orgProcedure
    .input(z.object({ id: documentFolderIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.repos.documentFolders.getByIdOrThrow(input.id);
      const parentId = (folder.parentId as DocumentFolderId | null | undefined) ?? null;
      await ctx.repos.documents.reassignFolder(input.id, parentId);
      await ctx.repos.documentFolders.reassignParent(input.id, parentId);
      await ctx.repos.documentFolders.hardDelete(input.id);
      return folder;
    }),

  moveDocument: orgProcedure
    .input(z.object({ documentId: documentIdSchema, folderId: documentFolderIdSchema.nullable() }))
    // Mapp-placering är organisations-metadata, inte dokumentets innehåll →
    // bumpar INTE versionen (ADR 0023; jfr klassificering/taggar).
    .mutation(({ ctx, input }) =>
      ctx.repos.documents.updateMetadata(input.documentId, { folderId: input.folderId }),
    ),

  /** Flyttar en mapp; blockerar cykler (mapp-in-i-sig-själv/descendant). */
  moveFolder: orgProcedure
    .input(z.object({ folderId: documentFolderIdSchema, targetParentId: documentFolderIdSchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (input.targetParentId) {
        let checkId: DocumentFolderId | null = input.targetParentId;
        while (checkId) {
          if (checkId === input.folderId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot move a folder into itself or a descendant",
            });
          }
          const parent = await ctx.repos.documentFolders.getById(checkId);
          checkId = (parent?.parentId as DocumentFolderId | null | undefined) ?? null;
        }
      }
      return ctx.repos.documentFolders.update(
        input.folderId, { parentId: input.targetParentId } as Partial<DocumentFolder>,
      );
    }),

  /** Breadcrumb-stig från rot till vald mapp. */
  breadcrumb: orgProcedure
    .input(z.object({ folderId: documentFolderIdSchema }))
    .query(async ({ ctx, input }) => {
      const path: { id: string; name: string }[] = [];
      let currentId: DocumentFolderId | null = input.folderId;
      while (currentId) {
        const folder = await ctx.repos.documentFolders.getById(currentId);
        if (!folder) break;
        path.unshift({ id: folder.id, name: folder.name });
        currentId = (folder.parentId as DocumentFolderId | null | undefined) ?? null;
      }
      return path;
    }),
};
