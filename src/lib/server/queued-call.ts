/**
 * Ett köat anrop som körs (#1276, ADR 0037) — optimistiskt i klienten eller
 * auktoritativt på servern. Båda körningarna ska ge SAMMA rader:
 *
 *   - rader proceduren skapar får id härlett ur anropets id (`newRowId`),
 *   - affärsdatum som inte står i input tas från när anropet GJORDES
 *     (`callTime`), inte från körningens klocka — servern kan köra om anropet
 *     långt senare (offline, en kö som töms nästa dag).
 *
 * Utanför ett köat anrop (demo, frågor, server-first-HTTP) beter sig båda som
 * förut: nytt uuidv7 respektive nu.
 */

import { derivedId } from "@/lib/shared/sync/derived-id";
import { uuidv7 } from "@/lib/shared/uuid";

/** Vilket köat anrop som körs: dess id (fröet) och när det gjordes (epoch-ms). */
export interface QueuedCallIdentity {
  readonly mutationId: string;
  readonly at: number;
}

/** Det som behövs ur en tRPC-context. */
export interface QueuedCallScope {
  queued?: QueuedCallIdentity | undefined;
}

/**
 * Id för en rad anropet skapar. `role` ska vara unik inom anropet
 * (`"payment"`, `"serviceNote"`, `"row:3"`).
 */
export function newRowId(scope: QueuedCallScope, role: string): string {
  return scope.queued ? derivedId(scope.queued.mutationId, role) : uuidv7();
}

/** När anropet gjordes — eller nu, utanför ett köat anrop. */
export function callTime(scope: QueuedCallScope): Date {
  return scope.queued ? new Date(scope.queued.at) : new Date();
}

/** Ett datum ur input, annars när anropet gjordes. */
export function dateOrCallTime(scope: QueuedCallScope, value: string | undefined): Date {
  return value ? new Date(value) : callTime(scope);
}
