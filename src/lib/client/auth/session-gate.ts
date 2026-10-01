/**
 * Sessionsgrinden i self-hosted (#1245, ADR 0018 Option A).
 *
 * App-skalet laddas utan inloggning — bara `/api` och `/git` kräver session i
 * proxyn. Då är det klienten som avgör, vid varje start, om användaren får
 * arbeta:
 *
 *   - Inloggad, samma identitet → fortsätt (och notera när den verifierades).
 *   - Inloggad, ny/annan identitet → bind principalen (första inloggningen).
 *   - Utloggad eller okänt läge (offline, IdP-/proxyavbrott, captive portal)
 *     INOM grace-tiden (default 7 dagar) → arbeta vidare under den cachade
 *     identiteten, med bannern "Logga in igen" (#1351). Ingen hård
 *     omdirigering: IdP:n kan vara nere, och användaren väljer när.
 *   - Utloggad utan giltig grace → till inloggningen (`/oauth2/start`).
 *   - Okänt läge utan giltig grace → besked; uppkoppling krävs — ett
 *     återkallat förtroende hålls inte vid liv i veckor.
 *   - Ingen OIDC i driften (`/oauth2/userinfo` saknas: basic-auth) → som förut.
 *
 * Servern omvaliderar ändå principalen vid varje synk; grinden är bara den
 * lokala gränsen för offline-arbete.
 */

import type { OidcClaims } from "@/lib/server/auth/oidc-auth-provider";
import { DEFAULT_OFFLINE_GRACE_MS } from "@/lib/shared/offline-grace";
import type { SessionNotice } from "./session-notice";
import type { SessionProbe } from "./session-probe";

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
  | { kind: "proceed-locally"; notice: Exclude<SessionNotice, "token-expired"> }
  | { kind: "login" }
  | { kind: "offline-expired" }
  | { kind: "offline-unbound" };

function withinGrace(cached: CachedIdentity, now: number, graceMs: number): boolean {
  return cached.verifiedAt !== undefined && now - cached.verifiedAt <= graceMs;
}

/**
 * Är den inloggade (proxyns claims) samma som den bundna? E-posten är
 * inloggningens identitet (ADR 0009); skiftläge och blanksteg spelar ingen roll.
 * Delas av grinden vid start och omvalideringen vid synk (#1404).
 */
export function sameIdentity(boundEmail: string, claims: Pick<OidcClaims, "email">): boolean {
  return boundEmail.trim().toLowerCase() === claims.email.trim().toLowerCase();
}

function decideOnline(claims: OidcClaims, cached: CachedIdentity | null): GateDecision {
  const same = cached !== null && sameIdentity(cached.email, claims);
  return same ? { kind: "proceed", verifiedNow: true } : { kind: "bind", claims };
}

/** Okänt läge: inom grace arbetar man lokalt; annars krävs uppkoppling. */
function decideUnreachable(cached: CachedIdentity | null, now: number, graceMs: number): GateDecision {
  if (!cached) return { kind: "offline-unbound" };
  return withinGrace(cached, now, graceMs) ? { kind: "proceed-locally", notice: "unreachable" } : { kind: "offline-expired" };
}

/** Bekräftat utloggad: inom grace en banner, annars till inloggningen (#1351). */
function decideSignedOut(cached: CachedIdentity | null, now: number, graceMs: number): GateDecision {
  return cached && withinGrace(cached, now, graceMs) ? { kind: "proceed-locally", notice: "signed-out" } : { kind: "login" };
}

/** Grindens beslut för en start. */
export function decideSessionGate(
  probe: SessionProbe, cached: CachedIdentity | null, now: number, graceMs: number = DEFAULT_OFFLINE_GRACE_MS,
): GateDecision {
  switch (probe.kind) {
    case "authenticated": return decideOnline(probe.claims, cached);
    case "signed-out": return decideSignedOut(cached, now, graceMs);
    case "unreachable": return decideUnreachable(cached, now, graceMs);
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
