/**
 * Genererar helper-UI:ns ikoner (ADR 0029) utan extern bildlib — en minimal
 * RGBA-PNG-encoder (node:zlib) ritar en enkel geometrisk "dokument"-symbol:
 *   - build/icon.png (1024)        → app-ikon (electron-builder gör icns/ico)
 *   - assets/trayTemplate.png (16) + @2x (32) → macOS menyrads-mall (monokrom)
 *
 * Avsiktligt enkel platshållar-design — byt mot en riktig ikon senare.
 * Kör: `bun make-icons.ts`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const CRC: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const len = data.length;
  const out = new Uint8Array(4 + body.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len);
  out.set(body, 4);
  dv.setUint32(4 + body.length, crc32(body));
  return out;
}

/** Skriv en RGBA-PNG från en `w*h*4`-buffer. */
function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // raw scanlines, filter byte 0 per rad
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
  }
  const idat = deflateSync(raw);
  return concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

type RGBA = [number, number, number, number];
type Setter = (x: number, y: number, c: RGBA) => void;
interface Rect { dx: number; dy: number; dw: number; dh: number; }

function fillBackground(set: Setter, size: number, radius: number, bg: RGBA): void {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (insideRounded(x, y, size, radius)) set(x, y, bg);
  }
}

/** Dokument-rektangel med vikt övre-höger hörn. */
function drawDocument(set: Setter, r: Rect, fg: RGBA): void {
  const fold = Math.round(r.dw * 0.32);
  for (let y = r.dy; y < r.dy + r.dh; y++) for (let x = r.dx; x < r.dx + r.dw; x++) {
    if (x - r.dx > r.dw - fold && r.dy + fold > y - r.dy + (r.dw - (x - r.dx))) continue;
    set(x, y, fg);
  }
}

function drawTextLines(set: Setter, r: Rect, color: RGBA): void {
  for (let n = 0; n < 3; n++) {
    const ly = r.dy + Math.round(r.dh * (0.45 + n * 0.16));
    for (let x = r.dx + Math.round(r.dw * 0.18); x < r.dx + Math.round(r.dw * 0.82); x++) {
      set(x, ly, color);
      set(x, ly + 1, color);
    }
  }
}

/** Rita en dokument-symbol (vit/svart) på `size×size`; `bg` = bakgrund (null = transparent). */
function drawDocIcon(size: number, fg: RGBA, bg: RGBA | null): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const set: Setter = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
  };
  if (bg) fillBackground(set, size, size * 0.22, bg);
  const dw = Math.round(size * 0.42);
  const dh = Math.round(size * 0.54);
  const rect: Rect = { dw, dh, dx: Math.round((size - dw) / 2), dy: Math.round((size - dh) / 2) };
  drawDocument(set, rect, fg);
  drawTextLines(set, rect, bg ?? [0, 0, 0, 0]);
  return encodePng(size, size, px);
}

function insideRounded(x: number, y: number, size: number, r: number): boolean {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2 || (x >= r && x < size - r) || (y >= r && y < size - r);
}

const blue: RGBA = [37, 99, 235, 255]; // blue-600 (matchar web-appen)
const white: RGBA = [255, 255, 255, 255];
const black: RGBA = [0, 0, 0, 255];

const root = import.meta.dir;
mkdirSync(join(root, "build"), { recursive: true });
mkdirSync(join(root, "assets"), { recursive: true });

writeFileSync(join(root, "build", "icon.png"), drawDocIcon(1024, white, blue));
// macOS tray = template: svart dokument-glyf + alpha, transparent bakgrund.
writeFileSync(join(root, "assets", "trayTemplate.png"), drawDocIcon(16, black, null));
writeFileSync(join(root, "assets", "trayTemplate@2x.png"), drawDocIcon(32, black, null));

process.stdout.write("Ikoner genererade: build/icon.png, assets/trayTemplate.png (+@2x)\n");
