/**
 * Offentligt uppdrag per ärendetyp (#1639) — ren logik, ingen I/O.
 *
 * Byrån markerar vilka av sina ärendetyper som är offentligt uppdrag (#1638).
 * För ett ärende med en sådan typ är betalningssättet alltid Offentligt
 * uppdrag. Servern avgör (`matter.create`/`matter.update`); klienten speglar
 * regeln bara för visning (ADR 0016). Namnen jämförs exakt, som byråns
 * `matterTypes`.
 */

import type { PaymentMethod } from "./schemas/enums";

/** Det regeln behöver ur byråns inställningar. Saknat/`null` = inga markerade. */
export interface PublicAssignmentSettings {
  publicAssignmentMatterTypes?: readonly string[] | null | undefined;
}

/** Betalningssättet som en markerad ärendetyp låser. */
export const PUBLIC_ASSIGNMENT_METHOD = "OFFENTLIGT_UPPDRAG" satisfies PaymentMethod;

/** Är ärendetypen markerad som offentligt uppdrag hos byrån? */
export function isPublicAssignmentType(
  org: PublicAssignmentSettings | null | undefined, matterType: string | null | undefined,
): boolean {
  return !!matterType && (org?.publicAssignmentMatterTypes ?? []).includes(matterType);
}

/** Det låsta betalningssättet för ärendetypen, eller `undefined` om det väljs fritt. */
export function lockedPaymentMethod(
  org: PublicAssignmentSettings | null | undefined, matterType: string | null | undefined,
): PaymentMethod | undefined {
  return isPublicAssignmentType(org, matterType) ? PUBLIC_ASSIGNMENT_METHOD : undefined;
}
