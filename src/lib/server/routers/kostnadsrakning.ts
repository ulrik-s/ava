/**
 * `kostnadsrakningRouter` — registrera en genererad kostnadsräkning och
 * emit:a ett event så regelmotorn kan reagera.
 *
 * En kostnadsräkning är ett dokument (HTML eller PDF) som lever som ett
 * vanligt document-objekt i AVA. Skillnaden mot vanlig upload:
 *   1. Vi taggar documentType="Kostnadsräkning"
 *   2. Vi emittar `kostnadsrakning.generated` med matterId + totalbelopp
 *      så regelmotorn kan trigga uppföljnings-actions (kopiera till
 *      ekonomi, posta i bokföring etc).
 *
 * Default: ingen regel är aktiv. Byrån slår på reglerna de vill ha.
 */

import { z } from "zod";
import { KOSTNADSRAKNING_DOCUMENT_TYPE } from "@/lib/shared/schemas/document";
import { emit } from "../events/emit";
import { router, orgProcedure } from "../trpc";

export const kostnadsrakningRouter = router({
  /**
   * Registrera en kostnadsräkning. Skriver document-metadata + emit:ar
   * `kostnadsrakning.generated`-event.
   *
   * Klienten har redan skrivit filen till FSA-handle (via OPFS) innan
   * detta anrop görs. Vi sparar bara metadata + triggar event-pipelinen.
   */
  record: orgProcedure
    .input(z.object({
      id: z.string(),
      matterId: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      storagePath: z.string(),
      /** Total summa i öre (inkl moms) att fakturera staten — för event-payload. */
      totalInclVat: z.number().int(),
      /** HUF-tid i minuter — bra att ha i auditen. */
      huvudforhandlingMinutes: z.number().int().nonnegative(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Registrera dokumentet (samma som document.register-flödet)
      const doc = await ctx.dataStore.documents.create({
        data: {
          id: input.id,
          matterId: input.matterId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          storagePath: input.storagePath,
          folderId: null,
          organizationId: ctx.orgId,
          documentType: KOSTNADSRAKNING_DOCUMENT_TYPE,
          analysisStatus: "DONE",
          analyzedAt: new Date(),
          uploadedById: ctx.user.id,
        } as never,
      });

      // 2. Emit event så regelmotorn kan trigga.
      //    OBS: går via `emit`-helpern (safeEmit) — INTE `ctx.dataStore.events.emit`
      //    direkt. I demo/git-backenden är event-loggen read-only och kastar
      //    `ReadOnlyError`; safeEmit sväljer det. Direkt-anrop här gjorde att
      //    hela mutationen rejektade EFTER att dokumentet skapats, vilket fick
      //    klientens record/invalidate att hoppas över → dokumentet dök aldrig
      //    upp i ärendet trots att UI:t visade "sparad".
      await emit.kostnadsrakningGenerated(ctx, input.matterId, {
        documentId: input.id,
        fileName: input.fileName,
        totalInclVat: input.totalInclVat,
        huvudforhandlingMinutes: input.huvudforhandlingMinutes,
        organizationId: ctx.orgId,
      });

      return doc;
    }),
});
