/**
 * Gemensamma helpers för document-router-modulerna.
 *
 * `assertDocAccess` och `assertMatterAccess` är internals i document-subrouters
 * och exporteras härifrån för att slippa duplicera dem i varje fil.
 *
 * Migrerade till repository-sömmen (ADR 0020): org-scopningen bor i
 * `repos.documents.getByIdInOrg` / `repos.matters.getByIdInOrg`.
 */

import { TRPCError } from "@trpc/server";
import type { DocumentFolder } from "@/lib/shared/schemas/document";
import type { DocumentFolderId, DocumentId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../../repositories/repositories";

export type DocCtx = { repos: Repositories; orgId: OrganizationId };

/** Verifiera att dokumentet finns och tillhör anropande org. */
export async function assertDocAccess(ctx: DocCtx, documentId: DocumentId) {
  const doc = await ctx.repos.documents.getByIdInOrg(documentId, ctx.orgId);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
  return doc;
}

/** Verifiera att ärendet finns och tillhör anropande org. */
export async function assertMatterAccess(ctx: DocCtx, matterId: MatterId) {
  const m = await ctx.repos.matters.getByIdInOrg(matterId, ctx.orgId);
  if (!m) throw new TRPCError({ code: "NOT_FOUND" });
  return m;
}

/** Verifiera att mappen finns och att dess ärende tillhör anropande org (#1449). */
export async function assertFolderAccess(ctx: DocCtx, folderId: DocumentFolderId): Promise<DocumentFolder> {
  const folder = await ctx.repos.documentFolders.getById(folderId);
  if (!folder) throw new TRPCError({ code: "NOT_FOUND" });
  await assertMatterAccess(ctx, folder.matterId);
  return folder;
}

/**
 * Målmapp för en flytt eller en ny mapp: `null` = ärendets rot, annars måste
 * mappen finnas och höra till samma ärende (#1449).
 */
export async function assertFolderInMatter(
  ctx: DocCtx, folderId: DocumentFolderId | null, matterId: MatterId,
): Promise<void> {
  if (folderId === null) return;
  const target = await assertFolderAccess(ctx, folderId);
  if (target.matterId !== matterId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Mappen hör till ett annat ärende." });
  }
}
