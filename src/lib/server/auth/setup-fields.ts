/**
 * Setup-fält (#1345) — värden som servern annars bestämmer själv.
 *
 * Skapa-procedurerna för tid, utlägg och ärenden tar emot några fält som
 * demo-generatorn, seed-skripten och E2E-riggarna behöver för att bygga upp en
 * historik (ADR 0003): en tidspost i en kollegas namn, ett eget á-pris, en
 * fakturakoppling, ett historiskt skapad-datum, ett eget ärendenummer eller en
 * annan status än aktiv. I UI:t sätts de aldrig — där bestämmer servern:
 * á-priset ur prislistan, fakturakopplingen av faktureringen, ärendenumret ur
 * serien (#174, #1242) och användaren ur inloggningen.
 *
 * Regeln:
 *   - **Köade anrop** (`ctx.queued`, ADR 0037) får aldrig bära dem. Kön bär
 *     bara det användaren gör i UI:t, och servern ska kunna lita på att en
 *     omkörning inte kringgår prislistan, faktureringen eller serien.
 *   - **Direkta anrop** får bära dem bara om anroparen är ADMIN —
 *     demo-generatorn och seed-skripten kör som administratör.
 *
 * `userId` räknas bara som setup-fält när det är någon annan än anroparen
 * (`onBehalfOf`): att skicka sitt eget id är detsamma som att utelämna det.
 */

import type { UserRole } from "@/lib/shared/schemas/enums";
import type { UserId } from "@/lib/shared/schemas/ids";
import type { QueuedCallScope } from "../queued-call";
import { TRPCError } from "../trpc-core";

/** Det policyn behöver ur en tRPC-context. */
export interface SetupFieldCaller extends QueuedCallScope {
  readonly user: { readonly id: UserId; readonly role: UserRole };
}

/** Fältnamn → skickat värde. `undefined` och `null` räknas som inte skickat. */
export type SetupFieldValues = Readonly<Record<string, unknown>>;

/** De setup-fält som faktiskt skickades. */
export function presentSetupFields(fields: SetupFieldValues): string[] {
  return Object.entries(fields).filter(([, v]) => v !== undefined && v !== null).map(([k]) => k);
}

/** `userId` om det är någon annan än anroparen, annars `undefined`. */
export function onBehalfOf(ctx: SetupFieldCaller, userId: UserId | undefined): UserId | undefined {
  return userId !== undefined && userId !== ctx.user.id ? userId : undefined;
}

/**
 * Kasta FORBIDDEN om anropet bär setup-fält det inte får sätta: alltid i ett
 * köat anrop, och i ett direkt anrop om anroparen inte är ADMIN.
 */
export function assertSetupFieldsAllowed(ctx: SetupFieldCaller, fields: SetupFieldValues): void {
  const used = presentSetupFields(fields);
  if (used.length === 0) return;
  const list = used.join(", ");
  if (ctx.queued) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Fälten sätts av servern och kan inte skickas med en synkad ändring: ${list}.` });
  }
  if (ctx.user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: `Endast administratörer kan sätta: ${list}.` });
  }
}
