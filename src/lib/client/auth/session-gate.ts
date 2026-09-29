/**
 * Sessionsgrinden i self-hosted (#1245, ADR 0018 Option A).
 *
 * App-skalet laddas utan inloggning — bara `/api` och `/git` kräver session i
 * proxyn. Då är det klienten som avgör, vid varje start, om användaren får
 * arbeta:
 *
 *   - Inloggad, samma identitet → fortsätt (och notera när den verifierades).
 *   - Inloggad, ny/annan identitet → bind principalen (första inloggningen).
 *   - Utloggad → till inloggningen (`/oauth2/start`).
 *   - Servern nås inte (offline, IdP-/proxyavbrott) → arbeta vidare under den
 *     cachade identiteten inom grace-tiden (default 7 dagar). Därefter krävs
 *     uppkoppling — ett återkallat förtroende hålls inte vid liv i veckor.
 *   - Ingen OIDC i driften (`/oauth2/userinfo` saknas: basic-auth) → som förut.
 *
 * Servern omvaliderar ändå principalen vid varje synk; grinden är bara den
 * lokala gränsen för offline-arbete.
 */

import type { OidcClaims } from "@/lib/server/auth/oidc-auth-provider";
import { DEFAULT_OFFLINE_GRACE_MS } from "@/lib/shared/offline-grace";
import type { UserinfoProbe } from "../backend/oidc-principal";

/** Den identitet klienten arbetade under senast (ur firma-config). */
export interface CachedIdentity {
  principalId: string;
  email: string;
  /** Epoch-ms när sessionen senast verifierades online. Saknas → aldrig. */
  verifiedAt: number | undefined;
}

export type GateDecision =
  | { kind: "bind"; claims: OidcClaims }
  | { kind: "proceed"; verifiedNow: boolean }
  | { kind: "login" }
  | { kind: "offline-expired" }
  | { kind: "offline-unbound" };

function withinGrace(cached: CachedIdentity, now: number, graceMs: number): boolean {
  return cached.verifiedAt !== undefined && now - cached.verifiedAt <= graceMs;
}

function decideOnline(claims: OidcClaims, cached: CachedIdentity | null): GateDecision {
  const same = cached !== null && cached.email.toLowerCase() === claims.email.toLowerCase();
  return same ? { kind: "proceed", verifiedNow: true } : { kind: "bind", claims };
}

function decideOffline(cached: CachedIdentity | null, now: number, graceMs: number): GateDecision {
  if (!cached) return { kind: "offline-unbound" };
  return withinGrace(cached, now, graceMs) ? { kind: "proceed", verifiedNow: false } : { kind: "offline-expired" };
}

/** Grindens beslut för en start. */
export function decideSessionGate(
  probe: UserinfoProbe, cached: CachedIdentity | null, now: number, graceMs: number = DEFAULT_OFFLINE_GRACE_MS,
): GateDecision {
  switch (probe.kind) {
    case "ok": return decideOnline(probe.claims, cached);
    case "unauthenticated": return { kind: "login" };
    case "unreachable": return decideOffline(cached, now, graceMs);
    case "absent": return { kind: "proceed", verifiedNow: false };
    default: {
      const exhaustive: never = probe;
      return exhaustive;
    }
  }
}

/** Inloggningens adress, med tillbaka-länk till där användaren var. */
export function loginUrl(current: { pathname: string; search: string }): string {
  return `/oauth2/start?rd=${encodeURIComponent(`${current.pathname}${current.search}`)}`;
}

/** Beskedet när klienten inte kan släppa in användaren offline. */
export function offlineGateMessage(decision: { kind: "offline-expired" | "offline-unbound" }): string {
  return decision.kind === "offline-expired"
    ? "Du har arbetat offline längre än tillåtet. Anslut till nätet så att inloggningen kan förnyas — dina lokala ändringar finns kvar."
    : "Du behöver vara uppkopplad första gången du loggar in.";
}
