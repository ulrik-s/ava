/**
 * PKCE (RFC 7636) — primitiver för helperns loopback-auth-flöde (ADR 0028 §2).
 *
 * Loopback-PKCE (RFC 8252) är primärvägen: helpern öppnar systembrowsern mot
 * byråns IdP och tar emot koden på `http://127.0.0.1:<port>/callback`. PKCE
 * binder auktoriserings-koden till denna klient utan client-secret (publik
 * native-klient) — `code_challenge` skickas i authorize-requesten, `code_verifier`
 * vid token-utbytet. Fungerar mot ALLA OIDC-IdP:er (BYO-IdP).
 *
 * Slumpkällan injiceras → deterministiska tester.
 */

import { createHash, randomBytes } from "node:crypto";

export interface Pkce {
  /** Hemlig verifier (skickas vid token-utbyte). */
  verifier: string;
  /** S256-hash av verifiern (skickas i authorize-requesten). */
  challenge: string;
  /** Alltid "S256" (vi använder aldrig "plain"). */
  method: "S256";
}

/** base64url utan padding (RFC 7636 §3). */
function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Skapa ett PKCE-par. `rand` injiceras för test (default 32 säkra bytes). */
export function generatePkce(rand: () => Buffer = () => randomBytes(32)): Pkce {
  const verifier = base64url(rand());
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

/** Slumpmässig `state`-parameter (CSRF-skydd för authorize→callback). */
export function randomState(rand: () => Buffer = () => randomBytes(16)): string {
  return base64url(rand());
}
