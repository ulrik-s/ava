/**
 * "Nytt i AVA" (#2010): nyheterna i de senaste releaserna, nyast först.
 * Bara på servern (porten `releaseNotes`); utan port är listan tom.
 */
import { z } from "zod";
import { releaseNoteSchema } from "@/lib/shared/release-notes";
import { orgProcedure, router } from "../trpc";

export const releaseNotesRouter = router({
  list: orgProcedure.output(z.array(releaseNoteSchema)).query(async ({ ctx }) => (await ctx.ports.releaseNotes?.list()) ?? []),
});
