/**
 * UUID v7 generator — kronologiskt sorterbar.
 *
 * v7-formatet bygger in millisekund-timestamp i de första 48 bitarna så att
 * id:n sorterar naturligt i tid. Det är guld värt för event-loggar: en
 * `ORDER BY id DESC LIMIT 100` ger oss de senaste eventen utan en separat
 * index-kolumn, och en JSONL-fil sorterad lexikografiskt är även sorterad
 * kronologiskt.
 *
 * Vi kunde dragit in en lib (`uuid` v9 stödjer det) men det är ~25 rader.
 */

import { randomBytes } from "node:crypto";

export function uuidv7(): string {
  const ts = Date.now(); // ms sedan epoch
  const bytes = randomBytes(16);

  // 48 bitar timestamp (ms) i bytes 0-5
  bytes[0] = (ts >>> 40) & 0xff;
  bytes[1] = (ts >>> 32) & 0xff;
  bytes[2] = (ts >>> 24) & 0xff;
  bytes[3] = (ts >>> 16) & 0xff;
  bytes[4] = (ts >>> 8) & 0xff;
  bytes[5] = ts & 0xff;

  // Version 7 i byte 6 (de fyra mest signifikanta bitarna)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // RFC 4122 variant i byte 8 (de två mest signifikanta bitarna)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
