/**
 * Ärendets betalningssätt på servern: regeln om offentligt uppdrag (#1639)
 * och loggningen av betalningssättsbyten (#1221).
 *
 * En ärendetyp som byrån markerat som offentligt uppdrag låser betalningssättet
 * till Offentligt uppdrag ({@link lockedPaymentMethod}). Låset följer ärendets
 * nuvarande typ: byter man till en markerad typ blir betalningssättet låst,
 * byter man bort går det att välja fritt igen. Regeln sätter bara värdet;
 * faktureringsflödena följer av betalningssättet som förut (ADR 0034).
 */

import { paymentMethodNote, rattsskyddNekadNote } from "@/lib/shared/billing-notes";
import { lockedPaymentMethod } from "@/lib/shared/public-assignment";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { OrganizationId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import type { Repositories } from "../repositories/repositories";
import { TRPCError } from "../trpc-core";
import { logMatterNote, type NoteCtx } from "./matter-note";

/** Det regeln behöver ur anropet: byråns inställningar. */
interface OrgCtx {
  repos: Pick<Repositories, "organizations">;
  orgId: OrganizationId;
}

/** Betalningssättet och ärendetypen i ett create-/update-anrop. */
interface PaymentMethodInput {
  matterType?: string | undefined;
  paymentMethod?: PaymentMethod | undefined;
}

/** Felet när ett annat betalningssätt skickas för en markerad ärendetyp. */
export const LOCKED_PAYMENT_METHOD_MESSAGE =
  "Betalningssättet bestäms av ärendetypen: ärendetypen är ett offentligt uppdrag.";

/** Det låsta betalningssättet för ärendetypen hos byrån, annars `undefined`. */
async function orgLock(ctx: OrgCtx, matterType: string | null | undefined): Promise<PaymentMethod | undefined> {
  if (!matterType) return undefined;
  return lockedPaymentMethod(await ctx.repos.organizations.getById(ctx.orgId), matterType);
}

/** `input` med betalningssättet utbytt, eller orört när inget ska sättas. */
function withMethod<T extends PaymentMethodInput>(input: T, method: PaymentMethod | undefined): T {
  return method ? { ...input, paymentMethod: method } : input;
}

/** Nytt ärende: en markerad ärendetyp ger Offentligt uppdrag, oavsett vad klienten skickar. */
export async function applyPaymentMethodOnCreate<T extends PaymentMethodInput>(ctx: OrgCtx, input: T): Promise<T> {
  return withMethod(input, await orgLock(ctx, input.matterType));
}

/**
 * Ändrat ärende: är ärendets typ (den nya i anropet, annars den nuvarande)
 * markerad avvisas ett annat betalningssätt, och betalningssättet blir
 * Offentligt uppdrag när anropet rör typen eller betalningssättet.
 */
export async function applyPaymentMethodOnUpdate<T extends PaymentMethodInput>(
  ctx: OrgCtx, before: Pick<Matter, "matterType">, input: T,
): Promise<T> {
  if (input.paymentMethod === undefined && input.matterType === undefined) return input;
  const locked = await orgLock(ctx, input.matterType ?? before.matterType);
  if (locked && input.paymentMethod !== undefined && input.paymentMethod !== locked) {
    throw new TRPCError({ code: "BAD_REQUEST", message: LOCKED_PAYMENT_METHOD_MESSAGE });
  }
  return withMethod(input, locked);
}

/** Det i en matter-uppdatering som loggas som anteckning (#1221). */
interface BillingChangeInput {
  paymentMethod?: PaymentMethod | undefined;
  rattsskyddNekadAt?: string | null | undefined;
}

/**
 * Faktureringsrelevanta ärendeändringar som tjänsteanteckning (#1221): nytt
 * betalningssätt och avslaget rättsskydd. Bara när värdet faktiskt ÄNDRAS —
 * ett formulär som sparar samma betalningssätt igen ska inte logga något.
 */
export async function logBillingChanges(
  repos: Pick<Repositories, "serviceNotes">, ctx: NoteCtx, before: Matter, input: BillingChangeInput,
): Promise<void> {
  if (input.paymentMethod && input.paymentMethod !== before.paymentMethod) {
    await logMatterNote(repos, ctx, before.id, paymentMethodNote(input.paymentMethod));
  }
  if (input.rattsskyddNekadAt && !before.rattsskyddNekadAt) {
    await logMatterNote(repos, ctx, before.id, rattsskyddNekadNote(input.rattsskyddNekadAt.slice(0, 10)));
  }
}
