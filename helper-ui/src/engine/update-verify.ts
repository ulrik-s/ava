/**
 * Self-update — äkthetskontroll av nedladdad binär (#110).
 *
 * Self-update över HTTPS + GitHub räcker inte: en komprometterad release
 * skulle auto-installeras på alla helpers (de pollar dagligen). Därför
 * verifierar vi en **detached Ed25519-signatur** över de nedladdade bytsen mot
 * en **pinnad publik nyckel** innan binären byts ut. Ingen match → vägra
 * (fail-closed), behåll gamla binären.
 *
 * Krypto: node:crypto Ed25519 (native i Bun) — ingen extern dep, jfr
 * git-commit-signeringens ed25519-bruk.
 *
 * ── Provisionering (engång, av dig) ──────────────────────────────────────
 *   1. Generera ett release-nyckelpar (Ed25519):
 *        openssl genpkey -algorithm ed25519 -out helper-release.key
 *   2. Lägg PRIVATA nyckeln som GitHub Actions-secret `HELPER_SIGNING_KEY`
 *      (hela PEM:en). Används BARA i release-jobbet (helper-release.yml).
 *   3. Härled PUBLIKA nyckeln som base64(DER SPKI) och baka in den nedan:
 *        openssl pkey -in helper-release.key -pubout -outform DER | base64 -w0
 *      Klistra resultatet i RELEASE_PUBLIC_KEY_SPKI_B64.
 *
 * ── Nyckelrotation ───────────────────────────────────────────────────────
 *   En helper kan bara verifiera mot den pubkey den bakats med. Byte kräver
 *   därför ett ÖVERGÅNGS-steg: släpp först en helper-version som accepterar
 *   BÅDE gamla och nya nyckeln (lägg båda i `acceptedPublicKeys`), låt flottan
 *   uppdatera till den, byt sedan signeringsnyckel i secret:en, och ta bort
 *   den gamla nyckeln i nästa version.
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";

/**
 * Pinnad publik release-nyckel, base64(DER SPKI). TOM tills du provisionerar
 * den (se filhuvudet). Tom nyckel = self-update vägrar (fail-closed) — det är
 * avsiktligt: en osignerad/okonfigurerad uppdatering ska aldrig installeras.
 */
export const RELEASE_PUBLIC_KEY_SPKI_B64 = "";

/** Suffix på signatur-asseten i releasen, t.ex. `ava-helper-linux-x64.sig`. */
export function signatureAssetName(binaryAsset: string): string {
  return `${binaryAsset}.sig`;
}

/** De publika nycklar denna binär litar på (flera bara under rotation). */
export function acceptedPublicKeys(): readonly string[] {
  return [RELEASE_PUBLIC_KEY_SPKI_B64].filter((k) => k.length > 0);
}

/** Verifiera en detached Ed25519-signatur mot EN pinnad pubkey (base64 SPKI). */
export function verifyEd25519(data: Uint8Array, signature: Uint8Array, spkiB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(spkiB64, "base64"), format: "der", type: "spki" });
    return cryptoVerify(null, data, key, signature);
  } catch {
    // Ogiltig nyckel/signatur-encoding → behandla som icke-verifierad, kasta ej.
    return false;
  }
}

/**
 * Säkerställ att `data` är signerad av NÅGON av de accepterade nycklarna.
 * Kastar (fail-closed) när ingen nyckel är pinnad eller ingen matchar.
 */
export function assertSignature(
  data: Uint8Array,
  signature: Uint8Array,
  keys: readonly string[] = acceptedPublicKeys(),
): void {
  if (keys.length === 0) {
    throw new Error("self-update avbruten: ingen pinnad release-nyckel (RELEASE_PUBLIC_KEY_SPKI_B64 tom)");
  }
  if (!keys.some((k) => verifyEd25519(data, signature, k))) {
    throw new Error("self-update avbruten: signaturen matchar ingen pinnad release-nyckel");
  }
}
