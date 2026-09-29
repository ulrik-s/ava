/**
 * Servern svarade 401 vid synk (#1245, ADR 0018) — fråga om sessionen igen:
 *
 *   - Utloggad (sessionen gick ut) → till inloggningen. Kön ligger kvar i
 *     IndexedDB och synkas efter inloggningen.
 *   - Inloggad, men servern vägrar ändå → kontot är inte längre aktivt
 *     (återkallat). Ändringarna hålls kvar på enheten — aldrig tyst borttagna —
 *     och användaren får veta varför de inte sparas (karantän).
 *   - Nås inte → inget särskilt besked; nästa synk försöker igen.
 */

import type { UserinfoProbe } from "../backend/oidc-principal";
import { loginUrl } from "./session-gate";

export interface RevalidateDeps {
  probe: () => Promise<UserinfoProbe>;
  redirect: (url: string) => void;
  location: () => { pathname: string; search: string };
}

export const SESSION_EXPIRED_MESSAGE = "Sessionen har gått ut — du skickas till inloggningen. Osynkade ändringar finns kvar.";
export const ACCOUNT_REVOKED_MESSAGE =
  "Ditt konto är inte längre aktivt i byrån. Osynkade ändringar finns kvar på enheten men sparas inte på servern förrän en administratör återaktiverar kontot.";

/** Beskedet att visa (null = inget särskilt). */
export async function revalidateSession(deps: RevalidateDeps): Promise<string | null> {
  const probe = await deps.probe();
  if (probe.kind === "unauthenticated") {
    deps.redirect(loginUrl(deps.location()));
    return SESSION_EXPIRED_MESSAGE;
  }
  return probe.kind === "ok" ? ACCOUNT_REVOKED_MESSAGE : null;
}
