/**
 * `StaticSyncSource` (#543, ADR 0025) — en `SyncTransport` utan server, för
 * demon (GH Pages). Hela poängen: demon hydrerar sin offline-cache via SAMMA
 * `reconcile → pull → applyPull → persist`-väg som den riktiga klienten, i
 * st.f. en separat seed-populerings-fork (`seed`-optionen + `loadDemoSeed`).
 *
 * Modell — en självständig loopback-"server" i klienten:
 *   - `pull(0)`       → den bundlade `DemoSource` plattad till `PulledChange[]`
 *                       (varje entitet i seeden = en kanonisk rad), cursor = N.
 *   - `pull(n)`       → ändringar med seq > n (loopback: det klienten själv
 *                       push:at sedan dess). Tomt om inget nytt.
 *   - `push(mutation)`→ `accepted` + raden läggs i loggen med nästa seq, så
 *                       NÄSTA pull serverar tillbaka den. Det dränerar
 *                       mutations-kön (ack i replay) OCH övar att en pull ser
 *                       klientens egna tidigare ändringar — hela reconcile-
 *                       loopen bevisas, deterministiskt, vid varje demobesök.
 *
 * Cursorn är en monoton sekvens (seq) över loggen (seed-rader 1..N, därefter
 * push:ade rader N+1, N+2 …) — exakt formen `change_log.seq` har på servern
 * (ADR 0017), så reconcile-motorn ser ingen skillnad mot en riktig server.
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import { ENTITY_NAME_BY_SOURCE_KEY } from "./entity-source-keys";
import type { QueuedMutation } from "./mutation-queue";
import type { PullResult, PulledChange, PushResult, SyncTransport } from "./sync-transport";

/** Platta en `DemoSource` (plural-nycklar → rad-arrayer) till kanoniska
 *  `PulledChange`-rader (singular entity), i en stabil nyckel-ordning. Okända
 *  source-nycklar hoppas (samma defensiva hållning som reconcile-apply). */
export function flattenSeedToChanges(seed: DemoSource): PulledChange[] {
  const out: PulledChange[] = [];
  const src = seed as Record<string, unknown>;
  for (const [sourceKey, entity] of Object.entries(ENTITY_NAME_BY_SOURCE_KEY)) {
    const rows = src[sourceKey];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) out.push({ entity, row: row as Record<string, unknown> });
  }
  return out;
}

export class StaticSyncSource implements SyncTransport {
  /** Append-only logg; seq = index+1 (monoton, börjar på 1). */
  private readonly log: Array<{ seq: number; change: PulledChange }> = [];
  private seq = 0;

  constructor(seed: DemoSource = {}) {
    for (const change of flattenSeedToChanges(seed)) this.append(change);
  }

  private append(change: PulledChange): void {
    this.seq += 1;
    this.log.push({ seq: this.seq, change });
  }

  pull(sinceCursor: number): Promise<PullResult> {
    const changes = this.log.filter((e) => e.seq > sinceCursor).map((e) => e.change);
    return Promise.resolve({ changes, cursor: this.seq });
  }

  push(mutation: QueuedMutation): Promise<PushResult> {
    // Loopback: spara raden så nästa pull serverar tillbaka den (kanonisk).
    // Delete → tombstone (deleted), annars upsert av raden.
    this.append({ entity: mutation.entity, row: mutation.row, deleted: mutation.kind === "delete" });
    return Promise.resolve({ status: "accepted", row: mutation.row });
  }

  /** Ersätt seeden (töm loggen, börja om från seq 0). Demo-vägen laddar seeden
   *  lazy först vid cache-miss → konstruerar tom och `reset`:ar sedan (#544). */
  reset(seed: DemoSource): void {
    this.log.length = 0;
    this.seq = 0;
    for (const change of flattenSeedToChanges(seed)) this.append(change);
  }
}
