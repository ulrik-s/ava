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
import type { DocumentId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
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
