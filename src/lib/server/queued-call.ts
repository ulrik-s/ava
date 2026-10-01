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

/** Hur gammalt ett köat anrop får vara när servern kör om det: 30 dagar (#1350). */
export const MAX_CALL_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Anropstiden servern kör om med (#1350). `enqueuedAt` kommer från klientens
 * klocka och styr affärsdatum (fakturadatum, serieår, normår, yrkandedag), så
 * den begränsas till [nu − 30 dagar, nu]:
 *
 *   - framtid → nu: en klocka som går före ger ändå "när det gjordes" så nära
 *     sanningen som servern vet; ingen faktura i nästa års serie,
 *   - äldre än 30 dagar → nu − 30 dagar: ingen faktura bakdaterad in i ett
 *     avslutat år. 30 dagar täcker en lång offline-period (en semester).
 *
 * Klämma, inte avvisa: en avvisning slänger användarens arbete för ett
 * klockfel. Servern är auktoritativ och svarar med radernas kanoniska läge,
 * så klientens optimistiska rader rättas. Deterministiskt: utfallet sparas
 * en gång per anrop (`sync_replays`), så samma anrop körs aldrig om med en
 * annan klocka.
 */
export function boundedCallTime(enqueuedAt: number, now: number): number {
  return Math.min(Math.max(enqueuedAt, now - MAX_CALL_AGE_MS), now);
}

/** Ett datum ur input, annars när anropet gjordes. */
export function dateOrCallTime(scope: QueuedCallScope, value: string | undefined): Date {
  return value ? new Date(value) : callTime(scope);
}
