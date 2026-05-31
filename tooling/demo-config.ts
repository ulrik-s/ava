/**
 * Demo-konfiguration — ENDA källa för demo-orgId, default-currentUserId,
 * email-domän och org-namn.
 *
 * Källas av:
 *   - `tooling/scripts/build-demo-repo.ts` (seedar datan + emitterar meta.json)
 *   - `src/lib/client/demo/static-params.ts` (enumererar params för export)
 *
 * Web-appen vid RUNTIME läser INTE den här filen — den hämtar
 * `.ava/meta.json` från samma origin (publicerad av build-demo-repo).
 * Då innehåller web-bundle:n inga hårdkodade demo-identifierare.
 */

export const DEMO_ORG_ID = "demo-firma-ab";
export const DEMO_CURRENT_USER_ID = "u-anna";
export const DEMO_EMAIL_DOMAIN = "ava.demo";
export const DEMO_ORG_NAME = "Demo Advokatbyrå AB";

/** Lösenord som demo-login accepterar för alla användare. */
export const DEMO_PASSWORD = "demo";

/** Path där build-demo-repo skriver meta.json (relativt out/). */
export const DEMO_META_PATH = ".ava/meta.json";
