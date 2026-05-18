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
      // TODO: faktisk mail-skickning via befintlig services/email.ts.
      // Lägger till i nästa pass när vi migrerar payment-reminders-flödet.
      console.info("[rules] sendEmail", { template, to, idempotencyKey, vars });
      return true;
    },

    async updateMatter(matterId, patch) {
      await deps.prisma.matter.update({
        where: { id: matterId },
        data: patch as Prisma.MatterUpdateInput,
      });
    },

    async extractFromDocument({ documentId, schema, into }) {
      // TODO: kopplas till befintlig document-analysis-service.
      console.info("[rules] llm.extract", { documentId, into, schemaKeys: Object.keys(schema) });
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
