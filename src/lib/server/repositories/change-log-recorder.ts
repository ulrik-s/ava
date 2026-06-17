/**
 * `ChangeLogRecorder` (#sync-bridge, ADR 0019 beslut 4 / ADR 0017) — skriver en
 * rad i den globala `change_log` per accepterad server-skrivning. Det är den
 * som driver delta-sync:ens `pull` (rader där `seq > cursor AND org_id = :org`).
 *
 * Bara den Drizzle-backade (server-)repo-vägen loggar — in-memory-vägen
 * (demo/offline) har ingen change_log. Loggning är opt-in via
 * `DrizzleRepository.enableChangeLog` så befintliga paritetstester inte påverkas.
 */

import { changeLog } from "../db/schema";
import type { AppDb } from "../db/types";

export type ChangeOp = "create" | "update" | "delete";

export interface ChangeLogEntry {
  organizationId: string;
  /** Singular entitetsnamn (ADR 0017), t.ex. "matter", "invoice". */
  entity: string;
  rowId: string;
  version: number;
  op: ChangeOp;
}

export interface ChangeLogRecorder {
  record(entry: ChangeLogEntry): Promise<void>;
}

/**
 * Slå på change_log-loggning på alla entitets-repos i ett `Repositories`-aggregat
 * (hoppar `transaction` + repos utan `enableChangeLog`). Server-sync-vägen.
 */
export function enableChangeLogOnAll(repos: object, recorder: ChangeLogRecorder): void {
  for (const value of Object.values(repos)) {
    const repo = value as { enableChangeLog?: (r: ChangeLogRecorder) => void };
    if (typeof repo?.enableChangeLog === "function") repo.enableChangeLog(recorder);
  }
}

/** Recorder som appendar till `change_log`-tabellen i samma db. */
export function createDbChangeLogRecorder(db: AppDb): ChangeLogRecorder {
  return {
    async record(entry: ChangeLogEntry): Promise<void> {
      await db.insert(changeLog).values({
        organizationId: entry.organizationId,
        entity: entry.entity,
        rowId: entry.rowId,
        version: entry.version,
        op: entry.op,
      } as never);
    },
  };
}
