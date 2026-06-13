/**
 * Bearer-PAT-autentisering för server-runtime:ns HTTP-API (#83, ADR 0013 §3 C1).
 *
 * Native-klienter (Office-add-ins) har en egen origin → OIDC-cookien (ADR 0009)
 * följer inte med. De auktoriseras i stället med ett **personligt access-token
 * (PAT)** i `Authorization: Bearer <token>`. Servern slår upp token → `Principal`
 * (maskin-/CLI-principal-vägen som ADR 0009 lämnar för icke-browser-klienter);
 * commit-författare härleds sedan ur principalen.
 *
 * Tokens lagras ALDRIG i klartext: en `PatRecord` håller bara SHA-256-hashen.
 * Verifiering hashar inkommande token och jämför **konstant-tid** (timing-safe)
 * mot kända hashar — ingen läckande tidsskillnad mellan "fel token" och
 * "rätt prefix".
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { Principal } from "@/lib/server/auth/principal";

/** SHA-256-hash (hex) av en token. Single source of truth för hash-formatet. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Plocka ut Bearer-token ur ett `Authorization`-headervärde.
 * Returnerar `null` om headern saknas eller inte är ett Bearer-schema.
 * Schemat matchas skiftlägesokänsligt ("Bearer"/"bearer"); token trimmas.
 */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/** Ett känt token (hashat) bundet till den principal det auktoriserar som. */
export interface PatRecord {
  /** SHA-256-hex av token (se {@link sha256Hex}). Aldrig klartext. */
  tokenHash: string;
  /** Principalen token auktoriserar som. */
  principal: Principal;
}

/** Slår upp en Bearer-token → `Principal`, eller `null` om okänd/ogiltig. */
export interface PatVerifier {
  verify(token: string): Principal | null;
}

/** Konstant-tid-jämförelse av två hex-hashar av samma längd. */
function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * `PatVerifier` mot en fast uppsättning {@link PatRecord} (från config/valv).
 * Verifierar genom att hasha inkommande token och konstant-tid-jämföra mot
 * varje känd hash. Jämför ALLA poster (ingen tidig retur) så svarstiden inte
 * läcker hur många prefix-tecken som stämde.
 */
export class StaticPatVerifier implements PatVerifier {
  private readonly records: readonly PatRecord[];
  constructor(records: readonly PatRecord[]) {
    this.records = records;
  }

  verify(token: string): Principal | null {
    if (!token) return null;
    const hash = sha256Hex(token);
    let found: Principal | null = null;
    for (const rec of this.records) {
      if (hexEquals(hash, rec.tokenHash)) found = rec.principal;
    }
    return found;
  }
}

/** Bygg en {@link PatRecord} ur en klartext-token (hashar den). Bekvämlighet
 *  för bootstrap/config; lagra helst hashen direkt och anropa inte denna. */
export function patRecord(token: string, principal: Principal): PatRecord {
  return { tokenHash: sha256Hex(token), principal };
}
