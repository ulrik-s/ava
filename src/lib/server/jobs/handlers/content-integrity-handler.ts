/**
 * Integritetskontrollen som schemalagt jobb (#1993) — konsumerar
 * `content-integrity`-kön, som `JOB_SCHEDULES` köar varje natt 02:00.
 *
 * Handlern kör `runContentIntegrityCheck` (#1145): saknat innehåll loggas som
 * `content.integrity.missing` (error) och en ren kontroll som
 * `content.integrity.ok`. Ett fel i själva läsningen kastas vidare, så att
 * pg-boss försöker igen (ADR 0024).
 */

import { type ContentIntegrityDeps, runContentIntegrityCheck } from "@/lib/server/integrity/content-integrity";
import { createLogger, type Logger } from "@/lib/shared/observability/logger";
import type { JobHandler } from "../job-worker-runtime";

/** Beroenden för integritetsjobbet: dokumentraderna, innehållslagret och byråns id. */
export interface ContentIntegrityJobDeps {
  deps: ContentIntegrityDeps;
  orgId: string;
}

/** Bygg en handler som kontrollerar att dokumentens innehåll finns i innehållslagret. */
export function createContentIntegrityHandler(
  cfg: ContentIntegrityJobDeps, log: Pick<Logger, "info" | "error"> = createLogger({ orgId: cfg.orgId }),
): JobHandler {
  return async (): Promise<void> => {
    await runContentIntegrityCheck(cfg.deps, log);
  };
}
