/**
 * `document.updateDetails` — juristens egna ändringar av ett dokuments
 * uppgifter: titel, filnamn, klassning (dokumenttyp), riktning, mottagare och
 * sammanfattning. Skild från `updateMetadata`, som AI-analysen skriver med.
 *
 * Klassningen ska överleva en ny AI-analys:
 *   - Ej analyserat än: en användarsatt typ respekteras redan (`manualKindOf`).
 *   - Analyserat med delar: första delen märks `MANUAL` (som `setPartKind`) —
 *     analysen behåller manuella delar och typen följer första delen.
 *
 * Bara metadata → versionen bumpas inte (ADR 0023). Filnamnet är ett
 * visningsnamn; lagringssökvägen ändras aldrig.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { cleanFileName } from "@/lib/shared/document-file-name";
import { documentDirectionSchema, documentKindSchema, documentRecipientSchema } from "@/lib/shared/schemas/document";
import { documentIdSchema } from "@/lib/shared/schemas/ids";
import { orgProcedure } from "../../trpc";
import { assertDocAccess } from "./shared";

const detailsInput = z.object({
  documentId: documentIdSchema,
  title: z.string().trim().max(300).nullable().optional(),
  fileName: z.string().max(400).optional(),
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

export const detailsProcedures = {
  updateDetails: orgProcedure
    .input(detailsInput)
    .mutation(async ({ ctx, input }) => {
      await assertDocAccess(ctx, input.documentId);
      const doc = await ctx.repos.documents.getById(input.documentId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      const data = simplePatch(input, doc.fileName);
      const kind = input.documentType;
      if (kind !== undefined && kind !== doc.documentType) {
        data.documentType = kind;
        // Analyserat med delar: gör första delen manuell så en ny analys inte skriver över klassningen.
        const [first] = await ctx.repos.documentParts.listForDocument(input.documentId);
        if (first) await ctx.repos.documentParts.update(first.id, { kind, source: "MANUAL" });
      }
      return ctx.repos.documents.updateMetadata(input.documentId, data);
    }),
};
