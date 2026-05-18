/**
 * Gemensamma helpers för document-router-modulerna.
 *
 * `assertDocAccess` och `assertMatterAccess` är internals i document-subrouters
 * och exporteras härifrån för att slippa duplicera dem i varje fil.
 */

import { TRPCError } from "@trpc/server";
import type { IDataStore } from "../../data-store/IDataStore";

export type DocCtx = { dataStore: IDataStore; orgId: string };

/** Verifiera att dokumentet finns och tillhör anropande org. */
export async function assertDocAccess(ctx: DocCtx, documentId: string) {
  const doc = await ctx.dataStore.documents.findFirst({
    where: { id: documentId, matter: { organizationId: ctx.orgId } },
    select: { id: true, matterId: true },
  });
  if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
  return doc;
}

/** Verifiera att ärendet finns och tillhör anropande org. */
export async function assertMatterAccess(ctx: DocCtx, matterId: string) {
  const m = await ctx.dataStore.matters.findFirst({
    where: { id: matterId, organizationId: ctx.orgId },
    select: { id: true },
  });
  if (!m) throw new TRPCError({ code: "NOT_FOUND" });
  return m;
}
