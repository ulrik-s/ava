/**
 * Scenario 4 — dokument (#1366): samtidiga uppladdningar, och de
 * klassificeringsjobb varje uppladdning startar (pg-boss, och ollama när
 * stacken körs med LLM). Krav: uppladdningarna lyckas och jobbkön töms.
 */

import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { uploadDocument } from "../actions";
import { ActionTally, dbFor, sleep, type LoadContext, type ScenarioResult } from "../context";

/** Jobb som inte är klara än. */
const OPEN_STATES = ["created", "retry", "active"] as const;

/** Antal öppna jobb i ett tillstånd-histogram. */
export function openJobs(states: Readonly<Record<string, number>>): number {
  return OPEN_STATES.reduce((sum, s) => sum + (states[s] ?? 0), 0);
}

async function openJobsAll(ctx: LoadContext): Promise<number> {
  const counts = await Promise.all(ctx.config.orgs.map(async (org) => openJobs(await dbFor(ctx, org.index).jobStates(JOB_QUEUES.classifyDocument))));
  return counts.reduce((a, b) => a + b, 0);
}

/** Vänta tills klassificeringskön är tom; ms, eller null om gränsen nåddes. */
async function waitForJobs(ctx: LoadContext, limitMs: number): Promise<number | null> {
  const t0 = performance.now();
  while (performance.now() - t0 < limitMs) {
    if ((await openJobsAll(ctx)) === 0) return Math.round(performance.now() - t0);
    await sleep(500);
  }
  return null;
}

/** Jobben och analysen i en byrå; de uppladdade dokumenten blir hämtbara i vanligt arbete. */
async function orgOutcome(ctx: LoadContext, orgIndex: number, ids: readonly string[]): Promise<{ label: string; jobs: Record<string, number>; analysis: Record<string, number>; violations: string[] }> {
  const db = dbFor(ctx, orgIndex);
  const jobs = await db.jobStates(JOB_QUEUES.classifyDocument);
  const analysis = await db.analysisStatuses(ids);
  ctx.documents.set(orgIndex, [...(ctx.documents.get(orgIndex) ?? []), ...ids]);
  const failed = jobs.failed ?? 0;
  return { label: `byrå ${orgIndex}`, jobs, analysis, violations: failed > 0 ? [`dokument byrå ${orgIndex}: ${failed} klassificeringsjobb misslyckades`] : [] };
}

export async function runDocuments(ctx: LoadContext): Promise<ScenarioResult> {
  const start = Date.now();
  const tally = new ActionTally();
  const uploaded = new Map<number, string[]>();
  const t0 = performance.now();
  await Promise.all(ctx.users.map(async (vu) => {
    for (let i = 0; i < ctx.config.uploadsPerUser; i++) {
      const id = await tally.run("uppladdning", () => uploadDocument(vu, ctx.matters.get(vu.index) ?? "", ctx.config.uploadKb, `dok u${vu.index}.${i}`));
      if (id) uploaded.set(vu.user.org.index, [...(uploaded.get(vu.user.org.index) ?? []), id]);
    }
  }));
  const uploadMs = Math.round(performance.now() - t0);
  const jobDrainMs = await waitForJobs(ctx, ctx.config.thresholds.maxJobDrainS * 1000);

  const perOrg = await Promise.all(ctx.config.orgs.map((org) => orgOutcome(ctx, org.index, uploaded.get(org.index) ?? [])));
  const violations = perOrg.flatMap((o) => o.violations);
  const jobs = Object.fromEntries(perOrg.map((o) => [o.label, o.jobs]));
  const analysis = Object.fromEntries(perOrg.map((o) => [o.label, o.analysis]));
  if (jobDrainMs === null) violations.push(`dokument: klassificeringskön tömdes inte inom ${ctx.config.thresholds.maxJobDrainS} s`);
  if (tally.failures > 0) violations.push(`dokument: ${tally.failures} uppladdningar misslyckades (se exempel)`);
  return {
    scenario: "documents",
    durationMs: Date.now() - start,
    details: { uploads: [...uploaded.values()].flat().length, uploadMs, jobDrainMs, jobs, analysis, actions: tally.toJSON() },
    violations,
  };
}
