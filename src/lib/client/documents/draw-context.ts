"use client";

/**
 * Ritkontexten för dokumentmotorn (ADR 0042): ramen (vänsterkant + bredd),
 * markören och de små ritprimitiver som flöde och tabell delar.
 *
 * Markören är NÄSTA BASLINJE mätt från sidans överkant. `PageCursor` bryter
 * sidan när ett element inte ryms ovanför den nedre marginalen; `FixedCursor`
 * (block, sidhuvud, sidfot) bryter aldrig.
 */

import type { PdfWriter } from "@/lib/client/kostnadsrakning/pdf-writer";
import type { LayoutAlign, RuleNode, TextStyle } from "@/lib/shared/documents/layout-ast";
import { LayoutError } from "@/lib/shared/documents/markup-parser";
import type { OrgImage } from "@/lib/shared/org-image";

/** Ramen innehållet ritas i: vänsterkant och bredd (pt). */
export interface Frame {
  left: number;
  width: number;
}

/** Flödets markör. */
export interface Cursor {
  /** Nästa baslinje, från sidans överkant. */
  y: number;
  /** Bryt sidan om `needed` pt inte ryms under markören. Sant om sidan bröts. */
  ensure(needed: number): boolean;
  /** Ny sida (`<page-break/>`). */
  pageBreak(): void;
}

/** Markören i dokumentets huvudflöde: bryter sidan vid den nedre marginalen. */
export class PageCursor implements Cursor {
  y: number;

  constructor(private readonly writer: PdfWriter, private readonly top: number, private readonly bottom: number) {
    this.y = top;
  }

  ensure(needed: number): boolean {
    if (this.y + needed <= this.bottom) return false;
    this.pageBreak();
    return true;
  }

  pageBreak(): void {
    this.writer.addPage();
    this.y = this.top;
  }
}

/** Markören i ett block, sidhuvud eller sidfot: fast placerad, bryter aldrig. */
export class FixedCursor implements Cursor {
  constructor(public y: number, private readonly where: string) {}

  ensure(): boolean {
    return false;
  }

  pageBreak(): void {
    throw new LayoutError(`<page-break/> kan inte stå i ${this.where}.`);
  }
}

/** Allt ett flödeselement behöver för att ritas. */
export interface DrawCtx {
  writer: PdfWriter;
  images: Readonly<Record<string, OrgImage | null>>;
  frame: Frame;
  cursor: Cursor;
  /** Text före ritning: sidnummer ersätts (eller avvisas) och tecknen görs WinAnsi-säkra. */
  text: (raw: string) => string;
}

/** x för en text eller bild med justeringen `align` i ramen `[left, left + width]`. */
export function alignedX(align: LayoutAlign, left: number, width: number): number {
  if (align === "right") return left + width;
  return align === "center" ? left + width / 2 : left;
}

/** Radbryt (tvättad) text inom `width` i stilen. Minst en rad, också för tom text. */
export function wrapLines(ctx: DrawCtx, raw: string, style: TextStyle, width: number): string[] {
  return ctx.writer.wrap(ctx.text(raw), style.font, style.size, width);
}

/** Rita en (redan tvättad) rad på baslinjen `top`. */
export function drawLine(ctx: DrawCtx, line: string, style: TextStyle, at: { align: LayoutAlign; left: number; width: number; top: number }): void {
  ctx.writer.text(line, alignedX(at.align, at.left, at.width), at.top, { font: style.font, size: style.size, align: at.align, color: style.color });
}

/** Rita en linje över ramen. `keep` kontrolleras av anroparen. */
export function drawRule(ctx: DrawCtx, rule: RuleNode): void {
  ctx.cursor.y += rule.spaceBefore;
  ctx.writer.rule(ctx.frame.left, ctx.frame.left + ctx.frame.width, ctx.cursor.y, rule.thickness, rule.color);
  ctx.cursor.y += rule.spaceAfter;
}
