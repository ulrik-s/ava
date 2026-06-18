/**
 * Innehålls-adressering av dokument-bytes (#518, ADR 0023). Universell
 * (browser + Node/bun) — delas av klient (hasha/koda före upload, avkoda efter
 * download) och server (avkoda vid upload, koda vid download).
 *
 * sha256 → immutabel, dedup, perfekt cache-bar (cachen behöver aldrig
 * invalideras). Binärt skickas som base64 över tRPC/JSON.
 */

/** sha256-hex av bytes via Web Crypto (`crypto` är global i browser/Node/bun). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `as BufferSource`: TS 5.7+ typar Uint8Array som `<ArrayBufferLike>` (kan vara
  // SharedArrayBuffer) men WebCrypto vill ha `BufferSource` — runtime är identiskt.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Repo-relativ, innehålls-adresserad sökväg för dokument-bytes. */
export function contentStoragePath(hash: string): string {
  return `documents/content/${hash}`;
}

// Chunk-storlek för base64 (undviker stack-overflow vid stora filer i
// `String.fromCharCode(...)`).
const CHUNK = 0x8000;

/** base64 → bytes (`atob` är global i browser/Node/bun). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** bytes → base64 (chunkad). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
