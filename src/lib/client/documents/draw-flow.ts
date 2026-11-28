"use client";

/**
 * Ritar flödeselementen (ADR 0042). Varje element: `keep` kontrolleras (sidan
 * bryts om utrymmet saknas), markören flyttas `spaceBefore`, elementet ritas
 * och markören flyttas förbi det plus `spaceAfter`. En text kräver dessutom
 * plats för varje rad, så långa stycken fortsätter på nästa sida.
 */

import type { BlockNode, FlowNode, ImageNode, TextNode } from "@/lib/shared/documents/layout-ast";
import { LayoutError } from "@/lib/shared/documents/markup-parser";
import { alignedX, drawLine, drawRule, FixedCursor, wrapLines, type DrawCtx } from "./draw-context";
import { drawTable } from "./draw-table";

function drawText(ctx: DrawCtx, n: TextNode): void {
  const { cursor, frame } = ctx;
  const lines = wrapLines(ctx, n.content, n.style, frame.width);
  cursor.ensure(Math.max(n.keep, n.style.leading));
  cursor.y += n.spaceBefore;
  lines.forEach((line, i) => {
    if (i > 0) cursor.ensure(n.style.leading);
    drawLine(ctx, line, n.style, { align: n.align, left: frame.left, width: frame.width, top: cursor.y });
    cursor.y += n.style.leading;
  });
  cursor.y += n.spaceAfter;
}

/** Rita en namngiven bild i sin ruta. Bilden finns inte (null) → rutan står tom och tar ingen plats. */
async function drawImage(ctx: DrawCtx, n: ImageNode): Promise<void> {
  if (!Object.hasOwn(ctx.images, n.src)) {
    throw new LayoutError(`<image src="${n.src}">: ingen bild med det namnet (finns: ${Object.keys(ctx.images).join(", ") || "inga"}).`);
  }
  const image = ctx.images[n.src];
  if (!image) return;
  const { cursor, frame } = ctx;
  cursor.ensure(Math.max(n.keep, n.height));
  cursor.y += n.spaceBefore;
  const box = { x: alignedX(n.align, frame.left, frame.width), top: cursor.y, maxWidth: Math.min(n.width, frame.width), maxHeight: n.height };
  // `align` "left" ger x = vänsterkant, "right" = högerkant och "center" = mitt — som PdfWriter.image.
  if (await ctx.writer.image(image, { ...box, align: n.align })) cursor.y += n.height + n.spaceAfter;
}

async function drawBlock(ctx: DrawCtx, n: BlockNode): Promise<void> {
  await drawFlow({ ...ctx, frame: { left: n.x, width: n.width }, cursor: new FixedCursor(n.top, "<block>") }, n.children);
}

async function drawNode(ctx: DrawCtx, n: FlowNode): Promise<void> {
  switch (n.kind) {
    case "text": return drawText(ctx, n);
    case "spacer": ctx.cursor.y += n.height; return;
    case "page-break": return ctx.cursor.pageBreak();
    case "rule": ctx.cursor.ensure(n.keep); return drawRule(ctx, n);
    case "image": return drawImage(ctx, n);
    case "block": return drawBlock(ctx, n);
    case "table": return drawTable(ctx, n);
  }
}

/** Rita flödeselementen i ordning, från markören. */
export async function drawFlow(ctx: DrawCtx, nodes: readonly FlowNode[]): Promise<void> {
  for (const n of nodes) await drawNode(ctx, n);
}
