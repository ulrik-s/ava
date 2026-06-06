/**
 * UUID-helpers (ADR 0003 — app-genererad UUIDv7).
 *
 * `uuidv7()` — tidsordnad UUID (48-bit ms-timestamp-prefix + slump). Funkar
 * i både browser och Node (`crypto.getRandomValues`). Tidsordningen ger bra
 * B-tree-insert-lokalitet i Postgres samtidigt som id:t kan genereras
 * klient-sidigt/offline (kärnan i local-first — se ADR 0001/0003).
 *
 * `crypto.randomUUID()` är v4 (slumpmässig) → använd INTE för primärnycklar.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) throw new Error("WebCrypto saknas (getRandomValues)");
  return c;
}

function format(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i]!.toString(16).padStart(2, "0"));
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Skriv 48-bit `ms` (big-endian) i `bytes[0..5]`. */
function writeTimestamp(bytes: Uint8Array, ms: number): void {
  // Undvik bitvis-operatorer (32-bit) för 48-bitstal → dela upp med /256.
  let t = Math.floor(ms);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
}

export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  writeTimestamp(bytes, now);
  getCrypto().getRandomValues(bytes.subarray(6));
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122-variant
  return format(bytes);
}

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}
