/**
 * Deterministisk UUID + slug-helpers för seed-data och meta-genering.
 *
 * `uuidv5(name, namespace)` — RFC 9562 §5.5 namnbaserad UUID (SHA-1).
 * Används för att härleda stabila primärnycklar från slug-strängar i
 * seed-data så att samma demo-bygge producerar samma UUID:n över tid.
 *
 * `slugify(text)` — normaliserar fritext till kebab-case ASCII.
 * Svenska tecken (å, ä, ö) transliteras till a, a, o.
 *
 * Browser-säker: pure JS, ingen Node-crypto. SHA-1 inline (~50 rader).
 */

const HEX = "0123456789abcdef";
const SLUG_TRANSLITERATION: Record<string, string> = {
  "å": "a", "ä": "a", "ö": "o",
  "Å": "a", "Ä": "a", "Ö": "o",
  "é": "e", "è": "e", "ê": "e",
  "É": "e", "È": "e", "Ê": "e",
  "ü": "u", "Ü": "u",
  "ß": "ss",
};

/** AVA:s rot-namespace för uuidv5. Slumpgenererad UUID v4 (engångs-konstant). */
export const AVA_NAMESPACE = "9f3c4a78-1b6d-4a2e-9c5f-0e1d8b3a7c92";

/**
 * RFC 9562 namnbaserad UUID v5.
 *
 * Algoritm: SHA-1(namespace_bytes || name_bytes) → första 16 byten,
 * sätt version 5 + RFC 4122-variant.
 */
export function uuidv5(name: string, namespace: string): string {
  const nsBytes = uuidToBytes(namespace);
  const nameBytes = utf8Encode(name);
  const input = new Uint8Array(nsBytes.length + nameBytes.length);
  input.set(nsBytes, 0);
  input.set(nameBytes, nsBytes.length);

  const hash = sha1(input);
  const bytes = hash.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122-variant
  return bytesToUuid(bytes);
}

/**
 * Normalisera fritext till kebab-case ASCII. Tomma strängar förblir
 * tomma — caller måste hantera det fallet.
 */
export function slugify(text: string): string {
  const transliterated = Array.from(text)
    .map((ch) => SLUG_TRANSLITERATION[ch] ?? ch)
    .join("");
  return transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── internals ─────────────────────────────────────────────────────────

function uuidToBytes(uuid: string): Uint8Array {
  const clean = uuid.replace(/-/g, "");
  if (clean.length !== 32) throw new Error(`Ogiltig UUID: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(HEX[(bytes[i] >> 4) & 0x0f] + HEX[bytes[i] & 0x0f]);
  }
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * SHA-1 i ren JS (FIPS 180-4 §6.1.2). Brett använt referensformat —
 * implementationen är ~50 rader och testas via känd RFC-vektor.
 */
function sha1(data: Uint8Array): Uint8Array {
  const padded = padMessage(data);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    const w = new Uint32Array(80);
    for (let i = 0; i < 16; i++) {
      const off = chunkStart + i * 4;
      w[i] = (padded[off] << 24) | (padded[off + 1] << 16) | (padded[off + 2] << 8) | padded[off + 3];
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20)      { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d;          k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else             { f = b ^ c ^ d;          k = 0xca62c1d6; }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return wordsToBytes([h0, h1, h2, h3, h4]);
}

function rotl(n: number, b: number): number {
  return ((n << b) | (n >>> (32 - b))) >>> 0;
}

function padMessage(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const padLen = ((data.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(padLen);
  padded.set(data, 0);
  padded[data.length] = 0x80;
  // 64-bit big-endian längd. JS-bitops är 32-bit → använd /256.
  let t = bitLen;
  for (let i = padLen - 1; i >= padLen - 8; i--) {
    padded[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  return padded;
}

function wordsToBytes(words: number[]): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    out[i * 4] = (words[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 8) & 0xff;
    out[i * 4 + 3] = words[i] & 0xff;
  }
  return out;
}
