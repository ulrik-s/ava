/**
 * Kombinera flera `PeerJob` till ETT (#80).
 *
 * PeerLoop kör ett enda `job` per tick. Server-runtime:n vill köra flera
 * connectors/regler (regelmotor #80 + Fortnox #82 + framtida): vi kör deras
 * `act`:er i sekvens mot samma caller, så alla mutationer hamnar i SAMMA
 * commit/cykel (och no-empty-commit-grinden i runPeerCycle gäller summan).
 * Ordningen bevaras; `null`/`undefined` (ej konfigurerade jobb) filtreras bort.
 */

import type { PeerJob } from "./peer-loop";
import type { PeerAct } from "./server-peer";

export function composeJobs(jobs: ReadonlyArray<PeerJob | null | undefined>): PeerJob | null {
  const active = jobs.filter((j): j is PeerJob => Boolean(j));
  if (active.length === 0) return null;
  if (active.length === 1) return active[0]!;

  const act: PeerAct = async (caller) => {
    for (const job of active) {
      await job.act(caller);
    }
  };
  return { act, message: active.map((j) => j.message).join("; ") };
}
