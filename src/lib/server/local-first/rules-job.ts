/**
 * Regelmotor-job (#80, ADR 0010) — schemalagda regler som en `PeerAct`.
 *
 * Designen återanvänder server-runtime:ns peer-loop (#81): varje tick kör
 * regel-acten mot working-copy:ns tRPC-caller, och peer-cykeln committar +
 * pushar ENDAST om något faktiskt skapades (no-empty-commit-grinden, #80).
 * Reglerna måste vara **idempotenta** — `paymentPlan.scanDueReminders` skapar
 * varje påminnelse (nyckel: plan+månad+typ) högst en gång, så att köra den
 * varje tick är säkert; cadensen blir naturligt "en gång per förfallomånad"
 * utan separat schemaläggnings-state.
 *
 * Fler regler läggs till genom att utöka `runRules` (alla idempotenta).
 */

import type { PeerJob } from "./peer-loop";

/** Delmängd av tRPC-callern regelmotorn använder. */
export interface RulesJobCaller {
  paymentPlan: {
    scanDueReminders: (input: Record<string, never>) => Promise<{ planned?: number } | unknown>;
  };
}

export interface RulesJobDeps {
  log?: (msg: string) => void;
}

/** Kör alla schemalagda (idempotenta) regler en gång. */
export async function runRules(caller: RulesJobCaller, deps: RulesJobDeps = {}): Promise<void> {
  const res = (await caller.paymentPlan.scanDueReminders({})) as { planned?: number };
  const planned = res?.planned ?? 0;
  if (planned && deps.log) deps.log(`Regelmotor: ${planned} påminnelser skapade`);
}

/** Paketera regelmotorn som ett `PeerJob` för server-runtime:ns peer-loop. */
export function makeRulesJob(deps: RulesJobDeps = {}): PeerJob {
  return {
    message: "chore(rules): schemalagda regler (påminnelser)",
    act: async (caller) => {
      await runRules(caller as unknown as RulesJobCaller, deps);
    },
  };
}
