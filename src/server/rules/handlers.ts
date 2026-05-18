/**
 * Step-handlers — den lim som kopplar deklarativa regel-steg till den
 * verkliga koden (mail-skickande, matter-CRUD, LLM-anrop osv).
 *
 * Vi exponerar två fabriker:
 *   - `buildLiveHandlers(deps)` — produktion: ringer riktiga services
 *   - `buildNoopHandlers()` — tester: spårar anrop, gör inga side-effects
 *
 * Idempotency-keys är handlerns ansvar. Kollar i event-loggen om en
 * `mail.sent` med samma idempotencyKey redan finns → returnera false.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type { StepHandlers } from "./execute";
import type { IDataStore } from "../data-store/IDataStore";
import { renderEmail } from "./email-templates";
import { sendEmail } from "../services/email";
import { analyzeDocument } from "../services/document-analysis";

export function buildLiveHandlers(deps: {
  prisma: PrismaClient;
  dataStore: IDataStore;
  organizationId: string;
}): StepHandlers {
  return {
    async sendEmail({ template, to, vars, idempotencyKey }) {
      if (idempotencyKey) {
        const already = await deps.prisma.avaEventLog.findFirst({
          where: {
            organizationId: deps.organizationId,
            type: "mail.sent",
            payload: { path: ["idempotencyKey"], equals: idempotencyKey } as Prisma.InputJsonValue as never,
          },
        });
        if (already) return false;
      }
      const rendered = renderEmail(template, vars ?? {});
      await sendEmail({ to, subject: rendered.subject, text: rendered.text, html: rendered.html });
      return true;
    },

    async updateMatter(matterId, patch) {
      await deps.prisma.matter.update({
        where: { id: matterId },
        data: patch as Prisma.MatterUpdateInput,
      });
    },

    async extractFromDocument({ documentId, schema, into }) {
      // Verifiera att dokumentet tillhör anropande byrå innan vi
      // triggar analysen. analyzeDocument tar bara id, men vi vill
      // inte att en regel i fel byrå kan trigga annans dokument.
      const doc = await deps.prisma.document.findFirst({
        where: { id: documentId, matter: { organizationId: deps.organizationId } },
        select: { id: true },
      });
      if (!doc) {
        console.warn(`[rules] llm.extract: dokument ${documentId} hittas inte i byrå ${deps.organizationId}`);
        return;
      }
      // Fire-and-forget: analyzeDocument är best-effort, kan ta sekunder.
      void analyzeDocument(documentId).catch((err) =>
        console.error("[rules] llm.extract misslyckades:", err),
      );
      // `schema` och `into` är metadata för framtida selectiva extractions —
      // nuvarande analyzeDocument körr full pipeline. När vi splittar upp
      // den (Fas 1 punkt 4) kan de användas för att styra vilken delta-schema
      // som tillämpas.
      void schema; void into;
    },

    async createTask({ assignTo, title, dueAt }) {
      // TODO: skapa task-rad. För nu logga bara — task-modellen finns inte ännu.
      console.info("[rules] task.create", { assignTo, title, dueAt });
    },
  };
}

export function buildNoopHandlers(): StepHandlers & {
  calls: { name: string; args: unknown }[];
} {
  const calls: { name: string; args: unknown }[] = [];
  return {
    calls,
    async sendEmail(args) { calls.push({ name: "sendEmail", args }); return true; },
    async updateMatter(matterId, patch) { calls.push({ name: "updateMatter", args: { matterId, patch } }); },
    async extractFromDocument(args) { calls.push({ name: "extractFromDocument", args }); },
    async createTask(args) { calls.push({ name: "createTask", args }); },
  };
}
