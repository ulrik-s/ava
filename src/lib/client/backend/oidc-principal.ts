/**
 * Self-hosted OIDC-login: brygga från oauth2-proxy → AVA-principal (#222, ADR 0009).
 *
 * oauth2-proxy (#222-infra) sköter hela OIDC-dansen och exponerar den
 * inloggade användarens claims på `/oauth2/userinfo` (samma origin → cookien
 * följer med automatiskt). Vi hämtar email därifrån och auktoriserar mot
 * användar-allowlisten i firma.git via `OidcAuthProvider` (#223).
 *
 * `sub`/`iss`-bindning utelämnas här (oauth2-proxy:s userinfo ger inte dem) →
 * matchning sker på email (obunden = första-login-vägen i resolvern). Att
 * skriva bindningen vid första login hanteras separat (#224).
 */

import { z } from "zod";
import {
  OidcAuthProvider,
  type AllowlistedUser,
  type OidcClaims,
} from "@/lib/server/auth/oidc-auth-provider";
import type { Principal } from "@/lib/server/auth/principal";

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

/**
 * Hämta + strikt-parsa claims från oauth2-proxy. `null` = ej inloggad
 * (401/302/redirect) eller saknad email → callern skickar till `/oauth2/start`.
 */
export async function fetchOidcClaims(
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  path: string = OIDC_USERINFO_PATH,
): Promise<OidcClaims | null> {
  const res = await fetchFn(path, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) return null;
  const info = oidcUserinfoSchema.parse(await res.json());
  if (!info.email) return null;
  return {
    email: info.email,
    subject: "",
    issuer: "",
    name: info.preferredUsername ?? info.user ?? "",
  };
}

/** Lös self-hosted-principalen ur OIDC-claims + firma.git-allowlisten (#223). */
export function resolveSelfHostedPrincipal(
  claims: OidcClaims | null,
  users: readonly AllowlistedUser[],
): Principal | null {
  return new OidcAuthProvider(claims, users).getPrincipal();
}
