/**
 * Folder-CRUD och flytt-operationer för dokumentträdet.
 *
 * Exporteras som ett objekt av procedurer som kompositionen i `document.ts`
 * spreadar in i den flata `documentRouter`. Detta bevarar det externa API:t
 * (`trpc.document.createFolder` etc.) samtidigt som filerna blir små.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { orgProcedure } from "../../trpc";
import { assertMatterAccess } from "./shared";
import {
  matterIdSchema,
  documentFolderIdSchema,
  documentIdSchema,
  type DocumentFolderId,
} from "@/lib/shared/schemas/ids";

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
      return ctx.dataStore.documentFolders.create({
        data: {
          name: input.name,
          matterId: input.matterId,
          parentId: input.parentId,
        },
      });
    }),

  renameFolder: orgProcedure
    .input(z.object({ id: documentFolderIdSchema, name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.documentFolders.update({
        where: { id: input.id },
        data: { name: input.name },
      });
    }),

  /** Flyttar innehåll till parent och raderar mappen. */
  deleteFolder: orgProcedure
    .input(z.object({ id: documentFolderIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.dataStore.documentFolders.findUniqueOrThrow({
        where: { id: input.id },
      });
      await ctx.dataStore.documents.updateMany({
        where: { folderId: input.id },
        data: { folderId: folder.parentId },
      });
      await ctx.dataStore.documentFolders.updateMany({
        where: { parentId: input.id },
        data: { parentId: folder.parentId },
      });
      return ctx.dataStore.documentFolders.delete({ where: { id: input.id } });
    }),

  moveDocument: orgProcedure
    .input(z.object({ documentId: documentIdSchema, folderId: documentFolderIdSchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.documents.update({
        where: { id: input.documentId },
        data: { folderId: input.folderId },
      });
    }),

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
          const parent = await ctx.dataStore.documentFolders.findUnique({
            where: { id: checkId },
            select: { parentId: true },
          });
          checkId = (parent?.parentId as DocumentFolderId | null | undefined) ?? null;
        }
      }
      return ctx.dataStore.documentFolders.update({
        where: { id: input.folderId },
        data: { parentId: input.targetParentId },
      });
    }),

  /** Breadcrumb-stig från rot till vald mapp. */
  breadcrumb: orgProcedure
    .input(z.object({ folderId: documentFolderIdSchema }))
    .query(async ({ ctx, input }) => {
      const path: { id: string; name: string }[] = [];
      let currentId: DocumentFolderId | null = input.folderId;
      while (currentId) {
        const folder = await ctx.dataStore.documentFolders.findUnique({
          where: { id: currentId },
          select: { id: true, name: true, parentId: true },
        });
        if (!folder) break;
        path.unshift({ id: folder.id, name: folder.name });
        currentId = (folder.parentId as DocumentFolderId | null | undefined) ?? null;
      }
      return path;
    }),
};
