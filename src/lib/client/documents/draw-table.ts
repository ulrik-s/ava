"use client";

/**
 * Ritar `<table>` (ADR 0042). En kroppsrad radbryter sina `wrap`-kolumner,
 * kräver `keep` (annars raderna × `leading` + tabellens `keepExtra`) och ritar
 * först de enradiga cellerna på radens baslinje, sedan de radbrutna. `thead`
 * och `tfoot` hålls ihop och radbryts inte. Med `repeatHeader` ritas `thead`
 * igen överst när kroppen bryter sidan. En rad med `fill` får en bakgrund.
 */

import type { TableItem, TableNode, TableRow, TableSection } from "@/lib/shared/documents/layout-ast";
import { drawLine, drawRule, wrapLines, type DrawCtx } from "./draw-context";

/** En cell med sina rader och sin kolumn. `wrapped`: cellen radbröts (kroppsrad, `wrap`-kolumn). */
interface CellLines {
  lines: string[];
  cell: TableRow["cells"][number];
  wrapped: boolean;
}

function cellLines(ctx: DrawCtx, row: TableRow, wrap: boolean): CellLines[] {
  return row.cells.map((cell) => {
    const wrapped = wrap && cell.column.wrap;
    const lines = wrapped ? wrapLines(ctx, cell.content, cell.style, cell.column.width) : [ctx.text(cell.content)];
    return { lines, cell, wrapped };
  });
}

function drawCell(ctx: DrawCtx, c: CellLines, leading: number): void {
  c.lines.forEach((line, i) => {
    const { column } = c.cell;
    drawLine(ctx, line, c.cell.style, { align: c.cell.align, left: ctx.frame.left + column.offset, width: column.width, top: ctx.cursor.y + i * leading });
  });
}

/**
 * Radens bakgrund (`fill`): över tabellens bredd, från `FILL_ASCENT` × radavståndet
 * ovanför baslinjen och radernas höjd + `spaceAfter` nedåt — så fyllda rader i
 * följd möts utan glipa. Ritas före texten (som annars skulle täckas).
 */
const FILL_ASCENT = 0.72;

function drawFill(ctx: DrawCtx, row: TableRow, lineCount: number): void {
  const last = row.cells.at(-1);
  if (!row.fill || !last) return;
  const width = last.column.offset + last.column.width;
  ctx.writer.rect(ctx.frame.left, ctx.cursor.y - FILL_ASCENT * row.leading, width, lineCount * row.leading + row.spaceAfter, row.fill);
}

/** Rita raden på markören: bakgrunden, enradiga celler, sedan de radbrutna. Flyttar markören förbi raden. */
function drawRowCells(ctx: DrawCtx, row: TableRow, cells: readonly CellLines[]): void {
  const lineCount = Math.max(1, ...cells.map((c) => c.lines.length));
  drawFill(ctx, row, lineCount);
  const ordered = [...cells.filter((c) => !c.wrapped), ...cells.filter((c) => c.wrapped)];
  for (const c of ordered) drawCell(ctx, c, row.leading);
  ctx.cursor.y += lineCount * row.leading + row.spaceAfter;
}

function drawSection(ctx: DrawCtx, section: TableSection): void {
  for (const item of section.items) {
    if (item.kind === "rule") drawRule(ctx, item);
    else drawRowCells(ctx, item, cellLines(ctx, item, false));
  }
}

/** Bryt sidan om `keep` inte ryms; rita då rubriken igen om tabellen vill det. */
function ensureWithHeader(ctx: DrawCtx, table: TableNode, keep: number): void {
  if (ctx.cursor.ensure(keep) && table.repeatHeader && table.head) drawSection(ctx, table.head);
}

function drawBodyItem(ctx: DrawCtx, table: TableNode, item: TableItem): void {
  if (item.kind === "rule") {
    ensureWithHeader(ctx, table, item.keep);
    drawRule(ctx, item);
    return;
  }
  const cells = cellLines(ctx, item, true);
  const lineCount = Math.max(1, ...cells.map((c) => c.lines.length));
  ensureWithHeader(ctx, table, item.keep ?? lineCount * item.leading + table.keepExtra);
  drawRowCells(ctx, item, cells);
}

/** Rita tabellen i ramen, från markören. */
export function drawTable(ctx: DrawCtx, table: TableNode): void {
  if (table.head) {
    ctx.cursor.ensure(table.head.keep);
    drawSection(ctx, table.head);
  }
  for (const item of table.body) drawBodyItem(ctx, table, item);
  if (table.foot) {
    ctx.cursor.ensure(table.foot.keep);
    drawSection(ctx, table.foot);
  }
}
