/**
 * Köposternas form (#413, #1265, #1347): en färdig rad eller ett procedur-anrop,
 * så som de sparas i IndexedDB och tolkas strikt när de läses. Egen fil så att
 * `mutation-queue.ts` håller sig under filstorleksgränsen (#1714).
 */

import { z } from "zod";
import { organizationIdSchema, userIdSchema } from "@/lib/shared/schemas/ids";
import { MAX_PROCEDURE_TOUCHES, rowRefSchema } from "./procedure-touches";

const rowRecord = z.record(z.string(), z.unknown());

/**
 * Vem som köade posten (#1347): användaren och byrån. Kön spelar bara upp sin
 * egen användares poster, och servern vägrar en post som inte är den
 * inloggades. Saknas på poster köade före #1347 — de ligger i användarens
 * egen databas och är därmed hennes.
 */
export const queueOwnerSchema = z.object({ principalId: userIdSchema, organizationId: organizationIdSchema }).strict();

/** Vem som köade posten. */
export type QueueOwner = z.infer<typeof queueOwnerSchema>;

/** En radpost (radkön), så som den sparas i IndexedDB. */
const queuedMutationSchema = z.object({
  /** Radpost (radkön). Saknas på poster persisterade före #1265 — de är rader. */
  type: z.literal("row").exactOptional(),
  /** Klient-genererat UUIDv7 — dedupe-nyckel + idempotent uppspelning. */
  mutationId: z.string(),
  entity: z.string(),
  kind: z.enum(["create", "update", "delete"]),
  /** Raden efter mutationen (bär sitt eget UUIDv7 `id` → server-upsert). */
  row: rowRecord,
  /** Föregående rad (update/delete) — för rollback/konflikt. */
  previous: rowRecord.exactOptional(),
  /** Observerad `version` vid mutationen (ADR 0017 optimistisk concurrency). */
  baseVersion: z.number().exactOptional(),
  enqueuedAt: z.number(),
  /** Köformatet posten skrevs i (#1247). Saknas på poster från före stämplingen = 1. */
  format: z.number().optional(),
  owner: queueOwnerSchema.exactOptional(),
});

/**
 * Ett köat procedur-anrop (#1265, ADR 0037): servern kör om `path(input)`
 * auktoritativt med samma `appRouter`. Klientens lokala resultat är bara
 * optimistiskt — `touches` säger vilka rader som ska ersättas av serverns läge.
 */
export const queuedProcedureCallSchema = z.object({
  type: z.literal("procedure"),
  mutationId: z.string(),
  /** tRPC-sökvägen, t.ex. `timeEntry.create` (se `QUEUED_PROCEDURES`). */
  path: z.string(),
  input: rowRecord,
  /** Klientkodens version när anropet köades (för migrering, #1247/#1269). */
  codeVersion: z.string(),
  touches: z.array(rowRefSchema).max(MAX_PROCEDURE_TOUCHES),
  enqueuedAt: z.number(),
  /** Köformatet posten skrevs i (#1247). Saknas på poster från före stämplingen = 1. */
  format: z.number().optional(),
  owner: queueOwnerSchema.exactOptional(),
});

/** En köpost så som den sparas (#1346): tolkas strikt när den läses ur IndexedDB. */
export const queueEntrySchema = z.union([queuedProcedureCallSchema, queuedMutationSchema]);

/** En radpost i kön. */
export type QueuedMutation = z.infer<typeof queuedMutationSchema>;
/** Ett köat procedur-anrop. */
export type QueuedProcedureCall = z.infer<typeof queuedProcedureCallSchema>;
/** En post i kön: en färdig rad eller ett procedur-anrop. */
export type QueueEntry = z.infer<typeof queueEntrySchema>;

/** Köades posten av `owner`? En post utan ägare (före #1347) hör till databasens användare. */
export function isOwnedBy(entry: QueueEntry, owner: QueueOwner): boolean {
  return !entry.owner
    || (entry.owner.principalId === owner.principalId && entry.owner.organizationId === owner.organizationId);
}

/** Är posten ett procedur-anrop (och inte en rad)? */
export function isProcedureCall(entry: QueueEntry): entry is QueuedProcedureCall {
  return entry.type === "procedure";
}
