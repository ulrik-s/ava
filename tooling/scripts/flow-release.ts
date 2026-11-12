#!/usr/bin/env bun
/**
 * Den automatiska taggen (tooling/agents/flow.yaml: `release`). Körs av
 * flödesvaktens klocka i ulrik-s/ava. När main har ändringar sedan senaste
 * taggen, CI är grön och perioden gått skapas nästa `v*`-tagg och
 * release.yml startas på den (en tagg skapad med repots token startar inte
 * workflows av sig själv). Servern driftsätter taggen inom fem minuter, och
 * den publicerade releasen startar nedbrytningen som levererar intaget.
 *
 * Stoppa: repovariabeln AUTO_RELEASE=off. FLOW_GUARD_MODE=enforce krävs.
 *
 *   bun tooling/scripts/flow-release.ts
 */
import { type GitHub, gitHub } from "./flow/github";
import { loadFlow } from "./flow/load";
import { type ReleaseDecision, releaseDecision } from "./flow/release";
import type { Flow } from "./flow/schema";
import type { Log } from "./flow-guard";

/** Beslutar och, om det är dags och `enforce`, taggar och startar releasen. */
export function runRelease(flow: Flow, gh: GitHub, opts: { now: number; disabled: boolean; enforce: boolean; log: Log }): ReleaseDecision {
  const last = gh.latestRelease();
  const mainSha = gh.mainSha();
  const decision = releaseDecision(flow, {
    now: opts.now,
    lastTag: last.tag,
    lastTagAt: last.at,
    subjects: gh.subjectsSince(last.tag),
    mainSha,
    ci: gh.lastRun("ci.yml", "branch=main"),
    disabled: opts.disabled,
  });
  if (!decision.release) {
    opts.log(`ingen tagg: ${decision.reason}`);
    return decision;
  }
  opts.log(`${decision.tag} på ${mainSha.slice(0, 8)}${opts.enforce ? "" : " (bara rapport)"}`);
  if (opts.enforce) {
    gh.createTag(decision.tag, mainSha);
    gh.dispatch("release.yml", decision.tag);
  }
  return decision;
}

if (import.meta.main) {
  const flow = loadFlow();
  const repo = Object.values(flow.machines).find((m) => m.items === "pulls")?.repo ?? "ulrik-s/ava";
  runRelease(flow, gitHub(repo), {
    now: Date.now(),
    disabled: process.env.AUTO_RELEASE === "off",
    enforce: process.env.FLOW_GUARD_MODE === "enforce",
    log: console.log,
  });
}
