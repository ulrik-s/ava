/**
 * Self-hosted OIDC-login: brygga från oauth2-proxy → AVA-principal (#222, ADR 0009).
 *
 * oauth2-proxy (#222-infra) sköter hela OIDC-dansen och exponerar den
 * inloggade användarens claims på `/oauth2/userinfo` (samma origin → cookien
 * följer med automatiskt). Vi hämtar email därifrån och auktoriserar mot
 * användar-allowlisten i firma.git via `OidcAuthProvider` (#223).
 *
 * `sub`/`iss`-bindning utelämnas här (oauth2-proxy:s userinfo ger inte dem) →
 * matchning sker på email. Det är den BESLUTADE modellen (#224, ADR 0009):
 * single-IdP → email-only; sub/iss-bindning uppskjuten tills multi-IdP blir
 * aktuellt (kräver då att oauth2-proxy exponerar sub/iss).
 */

import { z } from "zod";
import {
  OidcAuthProvider,
  type AllowlistedUser,
  type OidcClaims,
} from "@/lib/server/auth/oidc-auth-provider";
import type { Principal } from "@/lib/server/auth/principal";

// Re-export så klient-konsumenter (t.ex. demo-bootstrap) kan typa claims utan
// att importera server-modulen direkt över boundary.
export type { OidcClaims } from "@/lib/server/auth/oidc-auth-provider";

/** Delmängd av oauth2-proxy:s `/oauth2/userinfo`-svar vi använder. */
const oidcUserinfoSchema = z
  .object({
    email: z.string().default(""),
    user: z.string().default(""),
    preferredUsername: z.string().optional(),
  })
  .passthrough();

/** Default-endpoint oauth2-proxy exponerar (samma origin som appen). */
export const OIDC_USERINFO_PATH = "/oauth2/userinfo";

/** Sessionens läge enligt `/oauth2/userinfo` (#1245) — se `session-gate.ts`. */
export type UserinfoProbe =
  | { kind: "ok"; claims: OidcClaims }
  | { kind: "unauthenticated" }
  | { kind: "unreachable" }
  | { kind: "absent" };

/** Status → sessionens läge. 404 = ingen OIDC i driften; 5xx = proxyn/IdP:n nås inte. */
function probeFromStatus(status: number): UserinfoProbe {
  if (status === 404) return { kind: "absent" };
  return status >= 500 ? { kind: "unreachable" } : { kind: "unauthenticated" };
}

/**
 * Fråga oauth2-proxy om sessionen (#1245). Skiljer "utloggad" (→ logga in)
 * från "nås inte" (→ offline-grace): en omdirigering följs inte — den vore en
 * korsdomän-dans till IdP:n och ser då ut som ett nätverksfel.
 */
export async function probeUserinfo(
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  path: string = OIDC_USERINFO_PATH,
): Promise<UserinfoProbe> {
  let res: Response;
  try {
    res = await fetchFn(path, { headers: { Accept: "application/json" }, credentials: "same-origin", redirect: "manual" });
  } catch {
    return { kind: "unreachable" };
  }
  return probeFromResponse(res);
}

async function probeFromResponse(res: Response): Promise<UserinfoProbe> {
  if (res.type === "opaqueredirect") return { kind: "unauthenticated" };
  if (!res.ok) return probeFromStatus(res.status);
  // Utan oauth2-proxy (basic-auth-driften) svarar den statiska servern med
  // app-skalets HTML — det är ingen session att fråga om.
  if (!(res.headers.get("content-type") ?? "").includes("json")) return { kind: "absent" };
  const claims = claimsFrom(await res.json().catch(() => null));
  return claims ? { kind: "ok", claims } : { kind: "unauthenticated" };
}

/** Claims ur userinfo-svaret, eller null om det saknar email. */
function claimsFrom(body: unknown): OidcClaims | null {
  const info = oidcUserinfoSchema.safeParse(body);
  if (!info.success || !info.data.email) return null;
  return { email: info.data.email, subject: "", issuer: "", name: info.data.preferredUsername ?? info.data.user ?? "" };
}

/** Lös self-hosted-principalen ur OIDC-claims + firma.git-allowlisten (#223). */
export function resolveSelfHostedPrincipal(
  claims: OidcClaims | null,
  users: readonly AllowlistedUser[],
): Principal | null {
  return new OidcAuthProvider(claims, users).getPrincipal();
}

/**
 * Klassificera self-hosted-login utifrån claims + allowlist (#222-wiring):
 *   - `no-session`  — ingen OIDC-session (ej bakom oauth2-proxy / ej inloggad);
 *     callern faller tillbaka på sitt vanliga (icke-OIDC) beteende.
 *   - `denied`      — autentiserad IdP-identitet men INTE i byråns allowlist →
 *     neka (autentisering ≠ auktorisering, #223).
 *   - `authorized`  — allowlistad → principal ur firma.git.
 */
export type OidcLoginOutcome =
  | { kind: "authorized"; principal: Principal }
  | { kind: "denied"; email: string }
  | { kind: "no-session" };

export function classifyOidcLogin(
  claims: OidcClaims | null,
  users: readonly AllowlistedUser[],
): OidcLoginOutcome {
  if (!claims) return { kind: "no-session" };
  const principal = resolveSelfHostedPrincipal(claims, users);
  return principal ? { kind: "authorized", principal } : { kind: "denied", email: claims.email };
}
