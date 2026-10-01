/**
 * Inloggningens e-post (#1371). OIDC-inloggningen matchar claims mot
 * användarraderna på e-post (`OidcAuthProvider`, ADR 0009), så e-postadressen
 * ÄR kontots identitet: den som ändrar den pekar om kontot mot en annan
 * inloggning. Därför ändras den bara av en administratör, och varje byte
 * loggas.
 */

import { log } from "@/lib/shared/observability/logger";
import type { UserId } from "@/lib/shared/schemas/ids";
import { emit, type EmitCtx } from "../events/emit";
import { TRPCError } from "../trpc-core";

/** Samma inloggning? Skiftläge och omgivande blanksteg spelar ingen roll. */
export function sameLoginEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Byter anropet e-postadressen? Utelämnad eller samma inloggning = nej. */
export function changesLoginEmail(current: string, next: string | undefined): boolean {
  return next !== undefined && !sameLoginEmail(current, next);
}

/** Det kontrollen och loggen behöver ur en tRPC-context. */
export interface LoginEmailCtx extends EmitCtx {
  readonly user: { readonly id: UserId; readonly role: string; readonly organizationId: string };
}

/** Kasta FORBIDDEN om en icke-admin försöker byta e-postadress. */
export function assertMayChangeLoginEmail(ctx: LoginEmailCtx): void {
  if (ctx.user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "E-postadressen används för inloggningen och ändras bara av en administratör." });
  }
}

/**
 * Logga bytet: en strukturerad loggpost (ids, aldrig adresserna) och en
 * händelse i händelseloggen där en sådan finns.
 */
export async function auditLoginEmailChange(ctx: LoginEmailCtx, target: UserId): Promise<void> {
  log.info("user.email_changed", { userId: ctx.user.id, orgId: ctx.user.organizationId, ids: [target] });
  await emit.userAction(ctx, { action: "user.email_changed", targetUserId: target });
}
