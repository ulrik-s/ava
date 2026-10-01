/**
 * `SyncTransport` (ADR 0017, #414) — porten reconcile-motorn pratar med.
 * Den server-auktoritativa sidan (HttpDataStore-baserad, #411) implementerar
 * den; tester använder en fejk. Reconcile-motorn känner inte till HTTP/tRPC.
 */

import type { QueuedMutation, QueuedProcedureCall } from "./mutation-queue";

/** En kanonisk ändring servern returnerar i en delta-pull (tombstone via `deleted`). */
export interface PulledChange {
  entity: string;
  row: Record<string, unknown>;
  deleted?: boolean;
}

export interface PullResult {
  changes: PulledChange[];
  /** Serverns nya cursor-position (delta-sync). */
  cursor: number;
}

/**
 * Utfall av att pusha en köad mutation (ADR 0017 tre konfliktklasser):
 *   - `accepted` — applicerad; kanonisk rad (version bumpad) returneras.
 *                  `deleted` = raden är borttagen på servern (en radering, också
 *                  av en rad som redan var borta, #1397) och `row` är dess
 *                  tombstone — klienten tar bort raden, skriver den aldrig.
 *   - `rebased`  — LWW: servern hade nyare; kanonisk rad returneras.
 *   - `conflict` — surface: avvisad efter invariant/statemaskin-validering.
 */
export type PushResult =
  | { status: "accepted"; row: Record<string, unknown>; deleted?: true }
  | { status: "rebased"; row: Record<string, unknown> }
  | { status: "conflict"; reason: string; current?: Record<string, unknown> };

/**
 * Utfall av att servern kört om ett köat procedur-anrop (#1265, ADR 0037).
 * `rows` är de berörda radernas kanoniska läge efter körningen (tombstone om
 * raden inte finns) — klienten ersätter sitt optimistiska läge med dem.
 *   - `accepted` — anropet kördes (eller hade redan körts: idempotent).
 *   - `rejected` — en affärsregel avvisade anropet; `code` är tRPC-koden och
 *                  `reason` regelns eget meddelande (visas för användaren).
 * Tekniska fel (databasen, nätet) är INGET utfall: de kastas, och posten
 * ligger kvar i kön tills nästa försök.
 */
export type ProcedureReplayResult =
  | { status: "accepted"; rows: PulledChange[] }
  | { status: "rejected"; code: string; reason: string; rows: PulledChange[] };

/** En rad, utpekad med entitet och id (#1348). */
export interface RowRef {
  entity: string;
  id: string;
}

/** Hur många rader ett {@link SyncTransport.rows}-anrop högst frågar efter. */
export const MAX_ROW_REFS = 100;

export interface SyncTransport {
  pull(sinceCursor: number): Promise<PullResult>;
  /**
   * Radernas kanoniska läge just nu (#1348) — för att återställa en rad efter
   * en avvisad ändring när servern inte skickade sitt läge med avvisningen.
   * En rad som inte finns hos byrån kommer tillbaka som tombstone. Högst
   * {@link MAX_ROW_REFS} rader per anrop.
   */
  rows(refs: readonly RowRef[]): Promise<PulledChange[]>;
  push(mutation: QueuedMutation): Promise<PushResult>;
  /** Låt servern köra om ett köat procedur-anrop (#1265). */
  pushProcedure(call: QueuedProcedureCall): Promise<ProcedureReplayResult>;
}
