/**
 * `QueueBackedDocumentAnalyzer` (#518) — `IDocumentAnalyzer`-porten för
 * server-first som KÖAR ett `classify-document`-jobb durabelt på pg-boss i
 * st.f. att klassificera synkront. `classify-document-handler` plockar och
 * kör (filnamns-heuristik nu, server-LLM i Fas 3). Routrar anropar
 * `ctx.ports.documentAnalyzer.analyze(documentId)` som vanligt
 * (`document.analyze`, fire-and-forget) — durabiliteten är transparent.
 *
 * Boss:en hämtas lazy (`getBoss`): porten skapas i composition-rooten INNAN
 * jobb-kön startats. Saknas boss vid enqueue → tydligt fel.
 */

import type { PgBoss } from "pg-boss";
import type { IDocumentAnalyzer } from "@/lib/server/ports";
import { JOB_QUEUES } from "./job-queue";

export class QueueBackedDocumentAnalyzer implements IDocumentAnalyzer {
  constructor(
    private readonly getBoss: () => PgBoss | null,
    private readonly organizationId: string,
  ) {}

  async analyze(documentId: string): Promise<void> {
    const boss = this.getBoss();
    if (!boss) throw new Error("jobb-kön är inte redo — dokumentet kunde inte köas för klassificering");
    await boss.send(JOB_QUEUES.classifyDocument, { documentId, organizationId: this.organizationId });
  }
}
