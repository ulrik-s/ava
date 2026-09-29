/**
 * Tar servern emot en köpost i det här formatet (#1247)? Delas av radkön
 * (`DrizzleSyncStore.push`) och procedur-kön (`DrizzleProcedureReplayer`).
 *
 *   - dagens format → körs som den är,
 *   - ett äldre, stött format → migreras till dagens och körs,
 *   - för gammalt → avvisas med ett tydligt besked (ett utfall: kön går vidare),
 *   - nyare än servern → TEKNISKT fel (inget utfall): klienten behåller
 *     posten och försöker igen när servern har uppgraderats.
 */

import { TRPCError } from "@trpc/server";
import {
  classifyQueueFormat,
  formatOf,
  migrateQueuePayload,
  QUEUE_POLICY,
  tooNewMessage,
  tooOldMessage,
  type QueuePayload,
  type QueuePolicy,
} from "@/lib/shared/sync/queue-format";
import type { QueuedMutation, QueuedProcedureCall } from "../data-store/in-memory/mutation-queue";

/** Kör posten (i dagens format) — eller avvisa den med ett besked. */
export type Admission<T> = { kind: "run"; entry: T } | { kind: "reject"; reason: string };

/**
 * Gemensam gång för båda köerna: `lift` bygger om posten ur den migrerade
 * payloaden. `too-new` kastar ett tekniskt fel (inget utfall).
 */
function admit<T extends { format?: number | undefined }>(
  entry: T, payload: QueuePayload, lift: (lifted: QueuePayload) => T, policy: QueuePolicy,
): Admission<T> {
  const format = formatOf(entry);
  const verdict = classifyQueueFormat(format, policy);
  if (verdict === "too-new") throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: tooNewMessage(format) });
  if (verdict === "too-old") return { kind: "reject", reason: tooOldMessage(format) };
  if (verdict === "current") return { kind: "run", entry };
  const lifted = migrateQueuePayload(payload, format, policy.migrations, policy.current);
  return { kind: "run", entry: { ...lift(lifted), format: policy.current } };
}

export function admitProcedure(call: QueuedProcedureCall, policy: QueuePolicy = QUEUE_POLICY): Admission<QueuedProcedureCall> {
  return admit(call, { path: call.path, input: call.input },
    (l) => ({ ...call, path: l.path ?? call.path, input: l.input ?? call.input }), policy);
}

export function admitRow(m: QueuedMutation, policy: QueuePolicy = QUEUE_POLICY): Admission<QueuedMutation> {
  return admit(m, { entity: m.entity, row: m.row },
    (l) => ({ ...m, entity: l.entity ?? m.entity, row: l.row ?? m.row }), policy);
}
