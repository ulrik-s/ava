/**
 * Utloggningen hos IdP:n (#1347) — RP-initierad utloggning.
 *
 * oauth2-proxys `/oauth2/sign_out` tar bara bort proxyns egen cookie; IdP:ns
 * session (t.ex. Entra) lever kvar, och nästa inloggning i samma webbläsare
 * går då igenom tyst som samma person. Sätter driften
 * `AVA_OIDC_END_SESSION_URL` (IdP:ns `end_session_endpoint`, med
 * `post_logout_redirect_uri` tillbaka till `/login/?signedOut=1`) skickar
 * klienten utloggningen vidare dit via `rd`. IdP:ns domän måste då finnas i
 * oauth2-proxys `--whitelist-domain`, annars ignoreras `rd`.
 */

import { z } from "zod";

/** Utloggnings-config klienten hämtar (`system.signOutConfig`). */
export const signOutConfigSchema = z.object({ endSessionUrl: z.string().nullable() }).strict();

/** Utloggnings-config klienten hämtar (`system.signOutConfig`). */
export type SignOutConfig = z.infer<typeof signOutConfigSchema>;

const endSessionUrlSchema = z.url({ protocol: /^https?$/ });

/** IdP:ns utloggnings-URL ur env, eller null (saknas eller inte en http(s)-URL). */
export function signOutConfig(env: Record<string, string | undefined> = process.env): SignOutConfig {
  const parsed = endSessionUrlSchema.safeParse(env.AVA_OIDC_END_SESSION_URL?.trim());
  return { endSessionUrl: parsed.success ? parsed.data : null };
}
