/**
 * `<table>` i layoutspråket (ADR 0042):
 *
 *   <table keep-extra="5" repeat-header="true" size="9">
 *     <col width="66"/> <col width="*" wrap="true"/> <col width="80" align="right"/>
 *     <thead keep="40"> <row>…</row> <rule/> </thead>
 *     <row><cell>…</cell> …</row>   <rule/>   <row>…</row>
 *     <tfoot keep="30"> <rule/> <row>…</row> </tfoot>
 *   </table>
 *
 * En kolumn får bredden `*` = det som blir kvar av ramen. Varje rad har exakt
 * en cell per kolumn. Bara kroppens rader radbryts (i `wrap`-kolumnerna).
 */

import type { TableCell, TableColumn, TableItem, TableNode, TableRow, TableSection } from "./layout-ast";
import { ATTRS, attrsOf, type Attrs } from "./layout-attrs";
import { buildRule, elementChildren, finalStyle, inheritStyle, textContent, unexpected, type BuildCtx } from "./layout-style";
import { LayoutError, type MarkupElement } from "./markup-parser";

const TABLE_CHILDREN = ["col", "thead", "tfoot", "row", "rule"] as const;
const SECTION_CHILDREN = ["row", "rule"] as const;

function buildCell(el: MarkupElement, ctx: BuildCtx, column: TableColumn): TableCell {
  if (el.name !== "cell") throw unexpected(el, "row", ["cell"]);
  const a = attrsOf(ATTRS.cell, el);
  return { column, content: textContent(el), style: finalStyle(inheritStyle(ctx, a, el)), align: a.align ?? column.align };
}

function buildRow(el: MarkupElement, ctx: BuildCtx, columns: readonly TableColumn[]): TableRow {
  const a = attrsOf(ATTRS.row, el);
  const style = inheritStyle(ctx, a, el);
  const cellEls = elementChildren(el);
  if (cellEls.length !== columns.length) {
    throw new LayoutError(`Rad ${el.line}: <row> har ${cellEls.length} celler men tabellen har ${columns.length} kolumner.`);
  }
  const inner: BuildCtx = { ...ctx, inherited: style };
  const cells = columns.map((column, i) => buildCell(cellEls[i] ?? el, inner, column));
  return { kind: "row", cells, leading: finalStyle(style).leading, keep: a.keep, spaceAfter: a["space-after"] ?? 0 };
}

function buildItem(el: MarkupElement, ctx: BuildCtx, columns: readonly TableColumn[]): TableItem {
  return el.name === "rule" ? buildRule(el, ctx) : buildRow(el, ctx, columns);
}

function buildSection(el: MarkupElement, ctx: BuildCtx, columns: readonly TableColumn[]): TableSection {
  const a = attrsOf(ATTRS.section, el);
  const items = elementChildren(el).map((c) => {
    if (c.name !== "row" && c.name !== "rule") throw unexpected(c, el.name, SECTION_CHILDREN);
    return buildItem(c, ctx, columns);
  });
  return { keep: a.keep ?? 0, items };
}

/** Kolumnbredderna, med `*` = ramens återstod. */
function buildColumns(cols: readonly MarkupElement[], frameWidth: number): TableColumn[] {
  const parsed = cols.map((el) => ({ el, a: attrsOf(ATTRS.col, el) }));
  const stars = parsed.filter(({ a }) => a.width === "*");
  const second = stars[1];
  if (second) throw new LayoutError(`Rad ${second.el.line}: bara en <col> per tabell får ha width="*".`);
  const fixed = parsed.reduce((sum, { a }) => sum + (a.width === "*" ? 0 : a.width), 0);
  const rest = frameWidth - fixed;
  if (stars.length > 0 && rest < 0) throw new LayoutError(`Rad ${stars[0]?.el.line ?? 0}: kolumnerna är bredare än ramen (${fixed} > ${frameWidth} pt), inget kvar till width="*".`);
  let offset = 0;
  return parsed.map(({ a }) => {
    const column = columnOf(a, rest, offset);
    offset += column.width;
    return column;
  });
}

function columnOf(a: Attrs<"col">, rest: number, offset: number): TableColumn {
  return { offset, width: a.width === "*" ? rest : a.width, align: a.align ?? "left", wrap: a.wrap ?? false };
}

/** Tabellens delar sorterade per sort, i dokumentordning. */
interface TableParts {
  cols: MarkupElement[];
  head: MarkupElement | undefined;
  foot: MarkupElement | undefined;
  body: MarkupElement[];
}

function onlyOne(parts: TableParts, el: MarkupElement, key: "head" | "foot"): void {
  if (parts[key]) throw new LayoutError(`Rad ${el.line}: en tabell får bara ha en <${el.name}>.`);
  parts[key] = el;
}

function sortPart(parts: TableParts, el: MarkupElement): void {
  if (el.name === "col") parts.cols.push(el);
  else if (el.name === "thead") onlyOne(parts, el, "head");
  else if (el.name === "tfoot") onlyOne(parts, el, "foot");
  else if (el.name === "row" || el.name === "rule") parts.body.push(el);
  else throw unexpected(el, "table", TABLE_CHILDREN);
}

/** `<table>` → `TableNode`. */
export function buildTable(el: MarkupElement, ctx: BuildCtx): TableNode {
  const a = attrsOf(ATTRS.table, el);
  const parts: TableParts = { cols: [], head: undefined, foot: undefined, body: [] };
  for (const child of elementChildren(el)) sortPart(parts, child);
  if (parts.cols.length === 0) throw new LayoutError(`Rad ${el.line}: <table> saknar <col>.`);
  const columns = buildColumns(parts.cols, ctx.frameWidth);
  const inner: BuildCtx = { ...ctx, inherited: inheritStyle(ctx, a, el) };
  return {
    kind: "table",
    columns,
    head: parts.head && buildSection(parts.head, inner, columns),
    body: parts.body.map((b) => buildItem(b, inner, columns)),
    foot: parts.foot && buildSection(parts.foot, inner, columns),
    repeatHeader: a["repeat-header"] ?? true,
    keepExtra: a["keep-extra"] ?? 0,
  };
}
