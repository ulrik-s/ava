/**
 * Inloggningens e-post som nyckel (#1371, #1408). OIDC-inloggningen matchar
 * claims mot användarraderna på e-post (ADR 0009); skiftläge och omgivande
 * blanksteg spelar ingen roll. Samma normalisering som databasens unika index
 * `users_login_email_uq` (`lower(btrim(email))`, migrering 0042).
 *
 * Ren modul utan beroenden — delas av inloggningen, routrarna och repona.
 */

/** Adressen som inloggningsnyckel: utan omgivande blanksteg, gemener. */
export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Samma inloggning? Skiftläge och omgivande blanksteg spelar ingen roll. */
export function sameLoginEmail(a: string, b: string): boolean {
  return normalizeLoginEmail(a) === normalizeLoginEmail(b);
}
