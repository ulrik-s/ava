/**
 * Ärendets datumfält (#2098): hur ett datum ur ett anrop blir ett fält på
 * ärendet, och **Behåll som aktivt**, som sätter `keptActiveAt` till anropets tid.
 */
import type { MatterId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import { requireMatterInOrg, type OrgScope } from "../auth/org-scope";
import { callTime, type QueuedCallScope } from "../queued-call";

/** Sträng → Date, tom sträng/null → null, utelämnad → undefined (rör ej). */
export function toDateOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
}

/** Sätter ett datumfält (sträng → Date | null) på update-datat, men bara om
 *  det skickades med (undefined = rör ej). Håller update-mutationen ≤8. */
export function applyOptionalDate(data: Record<string, unknown>, key: string, value: string | null | undefined): void {
  const d = toDateOrNull(value);
  if (d !== undefined) data[key] = d;
}

/** Det Behåll som aktivt behöver ur en tRPC-context. */
export interface KeepActiveCtx extends OrgScope, QueuedCallScope {}

/**
 * Behåll som aktivt (#2098): den dagen bedömde någon att ärendet fortsätter.
 * Datumet är anropets tid, så serverns omkörning ur kön ger samma värde.
 * Ingen spärr på status: datumet skadar inte ett stängt ärende, och en spärr
 * hade gett en avvisad ändring i kön när en kollega hunnit avsluta ärendet.
 */
export async function keepMatterActive(ctx: KeepActiveCtx, id: MatterId): Promise<Matter> {
  await requireMatterInOrg(ctx, id);
  return ctx.repos.matters.update(id, { keptActiveAt: callTime(ctx) } satisfies Partial<Matter>);
}
