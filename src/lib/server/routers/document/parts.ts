/**
 * Dokumentdelar (#1220) — ett sammansatt dokument ("kallelse + stämning +
 * FUP" i EN PDF) har delar med kategori + sidintervall. Delarna skapas av
 * klassificeringsjobbets segmentering; användaren kan RÄTTA en dels kategori
 * (delen blir MANUAL och bevaras vid omklassificering så länge sidantalet är
 * oförändrat). Att flytta delgränser är medvetet utanför scope.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { documentKinds, isCustomKind, kindsAreManual, kindsFields } from "@/lib/shared/document-kinds";
import { documentKindSchema, type DocumentPart } from "@/lib/shared/schemas/document";
import { documentPartIdSchema, matterIdSchema } from "@/lib/shared/schemas/ids";
import { orgProcedure } from "../../trpc";
import { assertDocAccess, assertMatterAccess } from "./shared";

export const partProcedures = {
  /** Alla levande delar i ett ärendes dokument (dokumentpanelen), sorterade på sidordning. */
  partsByMatter: orgProcedure
    .input(z.object({ matterId: matterIdSchema }))
    .query(async ({ ctx, input }): Promise<DocumentPart[]> => {
      await assertMatterAccess(ctx, input.matterId);
      return ctx.repos.documentParts.listByMatter(input.matterId);
    }),

  /**
   * Rätta en dels kategori → `source = MANUAL`. Dokumentets typer följer med
   * (delarnas typer i sidordning + de egna typer det redan har), utom när en
   * person eller systemet satt typerna själv (ADR 0038, `kindsManual`).
   */
  setPartKind: orgProcedure
    .input(z.object({ partId: documentPartIdSchema, kind: documentKindSchema }))
    .mutation(async ({ ctx, input }): Promise<DocumentPart> => {
      const part = await ctx.repos.documentParts.getById(input.partId);
      if (!part) throw new TRPCError({ code: "NOT_FOUND" });
      await assertDocAccess(ctx, part.documentId);
      const doc = await ctx.repos.documents.getById(part.documentId);
      const updated = await ctx.repos.documentParts.update(part.id, { kind: input.kind, source: "MANUAL" });
      if (doc && !kindsAreManual(doc)) {
        const parts = await ctx.repos.documentParts.listForDocument(part.documentId);
        const custom = documentKinds(doc).filter(isCustomKind);
        await ctx.repos.documents.updateMetadata(part.documentId, kindsFields([...parts.map((p) => p.kind), ...custom], false));
      }
      return updated;
    }),
};
