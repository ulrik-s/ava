/**
 * Symmetrisk kryptering för secrets-valvet (#79, ADR 0008).
 *
 * AES-256-GCM (autentiserad — upptäcker manipulation/fel nyckel via auth-tag).
 * Master-nyckeln injiceras (env `AVA_SECRETS_KEY`, base64-kodade 32 byte) och
 * lagras ALDRIG på disk tillsammans med chiffertexten.
 *
 * Format på en krypterad sträng: `base64(iv):base64(tag):base64(ciphertext)`.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM-rekommendation
const KEY_LEN = 32; // AES-256

/** Validera + ladda master-nyckeln ur env-värdet (base64, 32 byte). */
export function loadMasterKey(envValue: string | undefined): Buffer {
  if (!envValue) {
    throw new Error("AVA_SECRETS_KEY saknas — sätt en base64-kodad 32-byte-nyckel.");
  }
  const key = Buffer.from(envValue, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(`AVA_SECRETS_KEY måste vara ${KEY_LEN} byte (base64-kodat); fick ${key.length}.`);
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(":");
}

/** Dekryptera. Kastar vid fel nyckel eller manipulerad data (GCM auth-tag). */
export function decryptSecret(blob: string, key: Buffer): string {
  const parts = blob.split(":");
  if (parts.length !== 3) {
    throw new Error("Ogiltigt secret-format (förväntade iv:tag:ciphertext).");
  }
  const iv = Buffer.from(parts[0]!, "base64");
  const tag = Buffer.from(parts[1]!, "base64");
  const ciphertext = Buffer.from(parts[2]!, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
