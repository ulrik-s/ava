/**
 * Dokumentets typer i procedurerna (ADR 0038): indata, behörighetsregeln för
 * AI kontra person, validering mot byråns typer — och de äldre formerna
 * (`documentType`, `setTags`) som gamla klienter och köade anrop (ADR 0037)
 * fortfarande skickar.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isDocumentKind } from "@/lib/shared/document-kind";
import {
  documentKinds, isCustomKind, kindsAreManual, kindsFields, type KindsFields, normalizeKinds, organizationKinds,
} from "@/lib/shared/document-kinds";
import type { Document } from "@/lib/shared/schemas/document";
import { documentIdSchema, type OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../../repositories/repositories";
import { orgProcedure } from "../../trpc";
import { assertDocAccess } from "./shared";

/** Typerna som indata: inbyggda koder, visningsnamn eller byråns egna typer. */
export const kindsInputSchema = z.array(z.string().trim().min(1).max(100)).max(20);

/** Det en skrivning av typerna kan bära (ny form eller den äldre `documentType`). */
export interface KindsRequest {
  kinds?: string[] | undefined;
  kindsManual?: boolean | undefined;
  /** Föråldrad: Äldre form (ADR 0038): EN typ. */
  documentType?: string | null | undefined;
}

/** Typerna som begärs, och om en person satte dem. Inget begärt → null. */
function requested(input: KindsRequest, manualByDefault: boolean): { kinds: string[]; manual: boolean } | null {
  if (input.kinds) return { kinds: input.kinds, manual: input.kindsManual ?? manualByDefault };
  if (input.documentType === undefined) return null;
  return { kinds: input.documentType ? [input.documentType] : [], manual: input.kindsManual ?? manualByDefault };
}

/** Typerna för ett nytt dokument. En anropare som anger typer har satt dem själv. */
export function createKindsPatch(input: KindsRequest): KindsFields | Record<string, never> {
  const req = requested(input, true);
  return req ? kindsFields(req.kinds, req.manual) : {};
}

/**
 * Typerna i en metadata-skrivning (AI-analys, klientens gissning eller en
 * uttrycklig överstyrning). En automatisk skrivning ändrar aldrig typer som
 * en person eller systemet satt.
 */
export function metadataKindsPatch(doc: Document, input: KindsRequest): KindsFields | Record<string, never> {
  const req = requested(input, false);
  if (!req || (!req.manual && kindsAreManual(doc))) return {};
  return kindsFields(req.kinds, req.manual);
}

/**
 * Typer en person sätter måste vara inbyggda, byråns egna, eller redan finnas
 * på dokumentet (en äldre fritext går att behålla). Annars BAD_REQUEST.
 */
export async function assertKnownKinds(
  repos: Pick<Repositories, "organizations">, orgId: OrganizationId, doc: Document, kinds: readonly string[],
): Promise<void> {
  const allowed = new Set([...organizationKinds(await repos.organizations.getById(orgId)), ...documentKinds(doc)]);
  const unknown = normalizeKinds(kinds).filter((k) => !isDocumentKind(k) && !allowed.has(k));
  if (unknown.length > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Okända dokumenttyper: ${unknown.join(", ")}. Lägg till dem under Inställningar → Dokumenttyper.` });
  }
}

export const kindProcedures = {
  /**
   * Föråldrad: `setTags` (#621) — äldre klienters sätt att sätta taggar. Tas
   * emot under övergången (ADR 0038): taggarna blir dokumentets egna typer,
   * de inbyggda typerna står kvar. Använd `document.updateDetails({ kinds })`.
   */
  setTags: orgProcedure
    .input(z.object({ documentId: documentIdSchema, tags: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      const doc = await ctx.repos.documents.getById(input.documentId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      await assertKnownKinds(ctx.repos, ctx.orgId, doc, input.tags);
      const builtIn = documentKinds(doc).filter((k) => !isCustomKind(k));
      return ctx.repos.documents.updateMetadata(input.documentId, kindsFields([...builtIn, ...input.tags], true));
    }),
};
