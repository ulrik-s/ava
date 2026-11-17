/**
 * `document.updateDetails` — juristens egna ändringar av ett dokuments
 * uppgifter: titel, filnamn, typer, riktning, mottagare och sammanfattning.
 * Skild från `updateMetadata`, som AI-analysen skriver med.
 *
 * Typerna (ADR 0038) sätts av en person → `kindsManual`, så en ny AI-analys
 * skriver inte över dem. Den äldre formen `documentType` (EN typ, från gamla
 * klienter och köade anrop) byter den primära typen och behåller resten.
 *
 * Bara metadata → versionen bumpas inte (ADR 0023). Filnamnet är ett
 * visningsnamn; lagringssökvägen ändras aldrig.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { cleanFileName } from "@/lib/shared/document-file-name";
import { documentKinds, kindsFields } from "@/lib/shared/document-kinds";
import { type Document, documentDirectionSchema, documentKindSchema, documentRecipientSchema } from "@/lib/shared/schemas/document";
import { documentIdSchema } from "@/lib/shared/schemas/ids";
import { orgProcedure } from "../../trpc";
import { assertKnownKinds, kindsInputSchema } from "./kinds";
import { assertDocAccess } from "./shared";

const detailsInput = z.object({
  documentId: documentIdSchema,
  title: z.string().trim().max(300).nullable().optional(),
  fileName: z.string().max(400).optional(),
  /** Dokumentets typer, primär först (ADR 0038). */
  kinds: kindsInputSchema.optional(),
  /** Föråldrad: Äldre form: byt den primära typen (ADR 0038). */
  documentType: documentKindSchema.optional(),
  direction: documentDirectionSchema.nullable().optional(),
  recipient: documentRecipientSchema.nullable().optional(),
  summary: z.string().max(5000).nullable().optional(),
});

type DetailsInput = z.infer<typeof detailsInput>;

/** Titel, riktning, mottagare och sammanfattning (tom text → null) + städat filnamn. */
function simplePatch(input: DetailsInput, currentFileName: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.fileName !== undefined) {
    const cleaned = cleanFileName(input.fileName, currentFileName);
    if (!cleaned) throw new TRPCError({ code: "BAD_REQUEST", message: "Filnamnet kan inte vara tomt." });
    data.fileName = cleaned;
  }
  for (const key of ["title", "summary"] as const) if (input[key] !== undefined) data[key] = input[key] || null;
  for (const key of ["direction", "recipient"] as const) if (input[key] !== undefined) data[key] = input[key];
  return data;
}

/** Typerna personen begär, eller null om de inte ändras. */
function requestedKinds(input: DetailsInput, doc: Document): string[] | null {
  if (input.kinds) return input.kinds;
  if (input.documentType === undefined) return null;
  return [input.documentType, ...documentKinds(doc).slice(1)];
}

export const detailsProcedures = {
  updateDetails: orgProcedure
    .input(detailsInput)
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      const doc = await ctx.repos.documents.getById(input.documentId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      const kinds = requestedKinds(input, doc);
      if (kinds) await assertKnownKinds(ctx.repos, ctx.orgId, doc, kinds);
      const data = { ...simplePatch(input, doc.fileName), ...(kinds ? kindsFields(kinds, true) : {}) };
      return ctx.repos.documents.updateMetadata(input.documentId, data);
    }),
};
