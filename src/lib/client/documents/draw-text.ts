"use client";

/**
 * Ritar `<text>` (ADR 0042): radbryts inom ramen, kräver plats för varje rad
 * (långa stycken fortsätter på nästa sida) och stryker under delarna ur
 * `<u>…</u>` (tillägg #2255). Understrykningen följer ordbrytningen: varje rad
 * får ett streck under sina understrukna tecken.
 */

import type { TextNode, TextSpan } from "@/lib/shared/documents/layout-ast";
import { alignedX, drawLine, type DrawCtx } from "./draw-context";

/** Strecket under baslinjen: avstånd och tjocklek som andel av teckenstorleken. */
const UNDERLINE_OFFSET = 0.12;
const UNDERLINE_THICKNESS = 0.06;
const MIN_UNDERLINE_THICKNESS = 0.5;

/** Ett understruket stycke på en rad: tecken `[start, end)` i radens text. */
type Segment = readonly [number, number];

/** Per tecken i den ihopslagna texten: ska det strykas under? */
function underlineFlags(spans: readonly TextSpan[]): boolean[] {
  // Per UTF-16-enhet, som `indexOf` räknar (texten är redan WinAnsi-tvättad).
  return spans.flatMap((s) => s.text.split("").map(() => s.underline));
}

/**
 * Radens tecken mappade mot texten: radbrytningen delar på blanktecken och
 * fogar ihop orden med ett mellanslag, så varje ord letas upp i ordning från
 * `from`. Mellanslaget mellan två ord ärver flaggan från tecknet efter ordet.
 */
function lineFlags(content: string, flags: readonly boolean[], line: string, from: number): { flags: boolean[]; next: number } {
  const out: boolean[] = [];
  let pos = from;
  line.split(" ").forEach((word, i) => {
    if (i > 0) out.push(flags[pos] ?? false);
    const at = content.indexOf(word, pos);
    for (let k = 0; k < word.length; k++) out.push(flags[at + k] ?? false);
    pos = at + word.length;
  });
  return { flags: out, next: pos };
}

/** Sammanhängande understrukna stycken. */
function segmentsOf(flags: readonly boolean[]): Segment[] {
  const segments: Segment[] = [];
  let start = -1;
  flags.forEach((on, i) => {
    if (on && start < 0) start = i;
    else if (!on && start >= 0) {
      segments.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) segments.push([start, flags.length]);
  return segments;
}

/** Radens vänsterkant när den ritas med justeringen `align`. */
function lineLeft(ctx: DrawCtx, n: TextNode, line: string): number {
  const x = alignedX(n.align, ctx.frame.left, ctx.frame.width);
  const width = ctx.writer.width(line, n.style.font, n.style.size);
  if (n.align === "right") return x - width;
  return n.align === "center" ? x - width / 2 : x;
}

function drawUnderlines(ctx: DrawCtx, n: TextNode, line: string, segments: readonly Segment[]): void {
  if (segments.length === 0) return;
  const { font, size } = n.style;
  const left = lineLeft(ctx, n, line);
  const top = ctx.cursor.y + size * UNDERLINE_OFFSET;
  const thickness = Math.max(MIN_UNDERLINE_THICKNESS, size * UNDERLINE_THICKNESS);
  for (const [start, end] of segments) {
    const x = left + ctx.writer.width(line.slice(0, start), font, size);
    ctx.writer.rule(x, x + ctx.writer.width(line.slice(start, end), font, size), top, thickness, n.style.color);
  }
}

/** Rita en rad på markören, med understrykningar. Returnerar var nästa rad börjar i texten. */
function drawTextLine(ctx: DrawCtx, n: TextNode, text: { content: string; flags: readonly boolean[]; line: string; from: number }): number {
  drawLine(ctx, text.line, n.style, { align: n.align, left: ctx.frame.left, width: ctx.frame.width, top: ctx.cursor.y });
  const mapped = lineFlags(text.content, text.flags, text.line, text.from);
  drawUnderlines(ctx, n, text.line, segmentsOf(mapped.flags));
  return mapped.next;
}

/** Rita en text från markören och flytta markören förbi den. */
export function drawText(ctx: DrawCtx, n: TextNode): void {
  const { cursor, frame } = ctx;
  // Delarna tvättas var för sig (tecken för tecken), så flaggorna följer texten.
  const spans = n.spans.map((s) => ({ text: ctx.text(s.text), underline: s.underline }));
  const content = spans.map((s) => s.text).join("");
  const flags = underlineFlags(spans);
  const lines = ctx.writer.wrap(content, n.style.font, n.style.size, frame.width);
  cursor.ensure(Math.max(n.keep, n.style.leading));
  cursor.y += n.spaceBefore;
  let from = 0;
  lines.forEach((line, i) => {
    if (i > 0) cursor.ensure(n.style.leading);
    from = drawTextLine(ctx, n, { content, flags, line, from });
    cursor.y += n.style.leading;
  });
  cursor.y += n.spaceAfter;
}
