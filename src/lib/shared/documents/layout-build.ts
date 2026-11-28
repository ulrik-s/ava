/**
 * `buildLayout` — från tolkad layoutmarkering till det typade layoutträdet
 * (ADR 0042). Här valideras allt: okända element och attribut, ogiltiga värden,
 * odefinierade stilar och tabeller vars rader inte matchar kolumnerna blir
 * `LayoutError` med rad och element.
 *
 * Elementen:
 *   <document>     rot: sidstorlek, marginaler, teckensnittsfamilj, titel
 *   <style>        namngiven textstil (font, size, color, leading)
 *   <page-header>  <page-footer>  på varje sida (pages="all|first|rest")
 *   <block>        fritt placerat (at="window|top-left|top-right" eller x/top)
 *   <text>  <image>  <table>  <rule>  <spacer>  <page-break>
 */

import type { BlockNode, FlowNode, ImageNode, LayoutDocument, PageBand, PageMargins, SpacerNode, TextNode } from "./layout-ast";
import { ATTRS, attrsOf, type Attrs, type StyleAttrs } from "./layout-attrs";
import { buildTable } from "./layout-build-table";
import {
  assertEmpty, buildRule, elementChildren, finalStyle, inheritStyle, ROOT_STYLE, spacingOf, textContent, unexpected,
  type BuildCtx, type PageGeometry,
} from "./layout-style";
import { LayoutError, parseMarkup, type MarkupElement } from "./markup-parser";

const PT_PER_MM = 72 / 25.4;

/** A4 i punkter (ISO 216), samma som `PdfWriter`. */
const A4 = { width: 595.28, height: 841.89 };

/** Standardmarginal (pt) när mallen inte anger någon. */
const DEFAULT_MARGIN = 50;

/**
 * Adressfältet för svenskt fönsterkuvert med fönstret till höger (H2: fönstret
 * 40–44 mm från kuvertets överkant), för A4 tvärvikt i C5 eller trevikt i E65.
 * Fältet börjar 45 mm från arkets överkant och 110 mm från vänsterkanten och är
 * 80 mm brett, så det slutar 20 mm från högerkanten. Byråns kuvert avgör — mät
 * och flytta med x/top om de skiljer sig.
 */
const WINDOW_MM = { x: 110, top: 45, width: 80 } as const;

const FLOW_ELEMENTS = ["text", "image", "table", "rule", "spacer", "page-break", "block"] as const;
const DOCUMENT_ONLY = ["style", "page-header", "page-footer"] as const;

function buildText(el: MarkupElement, ctx: BuildCtx): TextNode {
  const a = attrsOf(ATTRS.text, el);
  return { kind: "text", content: textContent(el), style: finalStyle(inheritStyle(ctx, a, el)), align: a.align ?? "left", ...spacingOf(a) };
}

function buildSpacer(el: MarkupElement): SpacerNode {
  assertEmpty(el);
  return { kind: "spacer", height: attrsOf(ATTRS.spacer, el).height };
}

function buildImage(el: MarkupElement): ImageNode {
  const a = attrsOf(ATTRS.image, el);
  assertEmpty(el);
  return { kind: "image", src: a.src, width: a.width, height: a.height, align: a.align ?? "left", ...spacingOf(a) };
}

/** Blockets förinställda läge (`at`) — x, top och bredd i punkter. */
function blockPreset(a: Attrs<"block">, page: PageGeometry): Partial<Pick<BlockNode, "x" | "top" | "width">> {
  const contentWidth = page.width - page.margins.left - page.margins.right;
  switch (a.at) {
    case "window": return { x: WINDOW_MM.x * PT_PER_MM, top: WINDOW_MM.top * PT_PER_MM, width: WINDOW_MM.width * PT_PER_MM };
    case "top-left": return { x: page.margins.left, top: page.margins.top, width: a.width ?? contentWidth };
    case "top-right": return { x: page.width - page.margins.right - (a.width ?? contentWidth), top: page.margins.top };
    case undefined: return {};
  }
}

function buildBlock(el: MarkupElement, ctx: BuildCtx): BlockNode {
  const a = attrsOf(ATTRS.block, el);
  const preset = blockPreset(a, ctx.page);
  const x = a.x ?? preset.x;
  const top = a.top ?? preset.top;
  if (x === undefined || top === undefined) throw new LayoutError(`Rad ${el.line}: <block> behöver at="…" eller både x och top.`);
  const width = a.width ?? preset.width ?? ctx.page.width - ctx.page.margins.right - x;
  return { kind: "block", x, top, width, children: buildFlow(el, { ...ctx, frameWidth: width }) };
}

function buildFlowNode(el: MarkupElement, ctx: BuildCtx, parent: string): FlowNode {
  switch (el.name) {
    case "text": return buildText(el, ctx);
    case "image": return buildImage(el);
    case "table": return buildTable(el, ctx);
    case "rule": return buildRule(el, ctx);
    case "spacer": return buildSpacer(el);
    case "page-break": return { kind: "page-break" };
    case "block": return buildBlock(el, ctx);
    default: throw unexpected(el, parent, FLOW_ELEMENTS);
  }
}

/** Ett elements barn som flödeselement. */
function buildFlow(el: MarkupElement, ctx: BuildCtx): FlowNode[] {
  return elementChildren(el).map((c) => buildFlowNode(c, ctx, el.name));
}

function buildBand(el: MarkupElement, ctx: BuildCtx): PageBand {
  const a = attrsOf(ATTRS.band, el);
  return { pages: a.pages ?? "all", top: a.top, children: buildFlow(el, ctx) };
}

/** Sidstorleken: A4, eller egna `width`/`height` i punkter. */
function pageSize(a: Attrs<"document">): { width: number; height: number } {
  return { width: a.width ?? A4.width, height: a.height ?? A4.height };
}

function marginsOf(a: Attrs<"document">): PageMargins {
  const m = a.margin ?? DEFAULT_MARGIN;
  return { top: a["margin-top"] ?? m, right: a["margin-right"] ?? m, bottom: a["margin-bottom"] ?? m, left: a["margin-left"] ?? m };
}

/** Dokumentets namngivna stilar (`<style>` direkt under `<document>`). */
function stylesOf(children: readonly MarkupElement[]): Map<string, StyleAttrs> {
  const styles = new Map<string, StyleAttrs>();
  for (const el of children.filter((c) => c.name === "style")) {
    const { name, ...style } = attrsOf(ATTRS.style, el);
    if (styles.has(name)) throw new LayoutError(`Rad ${el.line}: stilen "${name}" är redan definierad.`);
    assertEmpty(el);
    styles.set(name, style);
  }
  return styles;
}

function rootContext(a: Attrs<"document">, children: readonly MarkupElement[]): BuildCtx {
  const page: PageGeometry = { ...pageSize(a), margins: marginsOf(a) };
  return { styles: stylesOf(children), inherited: ROOT_STYLE, frameWidth: page.width - page.margins.left - page.margins.right, page };
}

/** `<document>` → `LayoutDocument`. */
function buildDocument(root: MarkupElement): LayoutDocument {
  if (root.name !== "document") throw new LayoutError(`Rad ${root.line}: rotelementet måste vara <document>, inte <${root.name}>.`);
  const a = attrsOf(ATTRS.document, root);
  const children = elementChildren(root);
  const ctx = rootContext(a, children);
  const bands = (name: string): PageBand[] => children.filter((c) => c.name === name).map((c) => buildBand(c, ctx));
  return {
    ...pageSize(a),
    margins: ctx.page.margins,
    fontFamily: a["font-family"] ?? "helvetica",
    title: a.title ?? "",
    subject: a.subject ?? "",
    headers: bands("page-header"),
    footers: bands("page-footer"),
    body: children.filter((c) => !(DOCUMENT_ONLY as readonly string[]).includes(c.name)).map((c) => buildFlowNode(c, ctx, "document")),
  };
}

/** Tolka och validera layoutmarkering. Kastar `LayoutError` med rad och element. */
export function buildLayout(markup: string): LayoutDocument {
  return buildDocument(parseMarkup(markup));
}
