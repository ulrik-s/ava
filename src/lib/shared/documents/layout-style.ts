/**
 * Byggkontexten för layoutträdet (ADR 0042): textstilarnas arv (dokument →
 * tabell → rad → cell), namngivna `<style>`-stilar och hjälpare som flera
 * elementbyggare delar.
 */

import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { FlowSpacing, LayoutColor, LayoutFont, PageMargins, RuleNode, TextStyle } from "./layout-ast";
import { ATTRS, attrsOf, type Attrs, type StyleAttrs } from "./layout-attrs";
import { LayoutError, type MarkupElement } from "./markup-parser";

/** En stil under arv: `leading` saknas tills någon nivå anger den. */
export interface InheritedStyle {
  font: LayoutFont;
  size: number;
  color: LayoutColor;
  leading: number | undefined;
}

/** Radavstånd när ingen nivå angett `leading`: 1,4 × teckenstorleken. */
const DEFAULT_LEADING_FACTOR = 1.4;

/** Dokumentets grundstil: 10 pt, normal vikt, svart. */
export const ROOT_STYLE: InheritedStyle = { font: "regular", size: 10, color: [0, 0, 0], leading: undefined };

/** Sidans mått — för blockens förinställda positioner. */
export interface PageGeometry {
  width: number;
  height: number;
  margins: PageMargins;
}

/** Det varje elementbyggare får: stilarna, den ärvda stilen och ramens bredd. */
export interface BuildCtx {
  styles: ReadonlyMap<string, StyleAttrs>;
  inherited: InheritedStyle;
  /** Ramens bredd (pt) — innehållsytan eller blockets bredd. */
  frameWidth: number;
  page: PageGeometry;
}

/** Bara textstilens fält ur ett attributobjekt. */
function styleFields(a: StyleAttrs): Partial<Pick<InheritedStyle, "font" | "size" | "color" | "leading">> {
  return omitUndefined({ font: a.font, size: a.size, color: a.color, leading: a.leading });
}

function namedStyle(ctx: BuildCtx, name: string, el: MarkupElement): StyleAttrs {
  const found = ctx.styles.get(name);
  if (!found) throw new LayoutError(`Rad ${el.line}: <${el.name}> pekar på stilen "${name}", som inte finns (definiera den med <style name="${name}">).`);
  return found;
}

/** Ärv en stil: förälderns, sedan den namngivna `style`, sedan elementets egna attribut. */
export function inheritStyle(ctx: BuildCtx, attrs: StyleAttrs, el: MarkupElement): InheritedStyle {
  const named = attrs.style === undefined ? {} : namedStyle(ctx, attrs.style, el);
  return { ...ctx.inherited, ...styleFields(named), ...styleFields(attrs) };
}

/** Den färdiga stilen — radavståndet räknas fram om ingen nivå angav det. */
export function finalStyle(s: InheritedStyle): TextStyle {
  return { font: s.font, size: s.size, color: s.color, leading: s.leading ?? s.size * DEFAULT_LEADING_FACTOR };
}

/** Färgen för en linje: egen `color`, annars den namngivna stilens, annars svart. */
function ruleColor(ctx: BuildCtx, a: Attrs<"rule">, el: MarkupElement): LayoutColor {
  if (a.color) return a.color;
  return (a.style === undefined ? undefined : namedStyle(ctx, a.style, el).color) ?? ROOT_STYLE.color;
}

/** Standardtjocklek för `<rule>` (pt). */
const DEFAULT_RULE_THICKNESS = 0.5;

/** `<rule>` — i flödet och mellan tabellrader. */
export function buildRule(el: MarkupElement, ctx: BuildCtx): RuleNode {
  const a = attrsOf(ATTRS.rule, el);
  assertEmpty(el);
  return { kind: "rule", thickness: a.thickness ?? DEFAULT_RULE_THICKNESS, color: ruleColor(ctx, a, el), ...spacingOf(a) };
}

/** Flödeselementens utrymmesattribut, med noll som standard. */
export function spacingOf(a: { keep?: number | undefined; "space-before"?: number | undefined; "space-after"?: number | undefined }): FlowSpacing {
  return { keep: a.keep ?? 0, spaceBefore: a["space-before"] ?? 0, spaceAfter: a["space-after"] ?? 0 };
}

/** Elementets text: textnoderna ihopslagna, blanktecken komprimerade som i HTML. */
export function textContent(el: MarkupElement): string {
  const child = el.children.find((c) => c.kind === "element");
  if (child?.kind === "element") throw new LayoutError(`Rad ${child.line}: <${el.name}> får bara innehålla text, inte <${child.name}>.`);
  return el.children.map((c) => (c.kind === "text" ? c.text : "")).join("").replace(/\s+/g, " ").trim();
}

/** Elementbarnen; text mellan dem får bara vara blanktecken. */
export function elementChildren(el: MarkupElement): MarkupElement[] {
  const stray = el.children.find((c) => c.kind === "text" && c.text.trim() !== "");
  if (stray) throw new LayoutError(`Rad ${stray.line}: text direkt i <${el.name}> — lägg den i <text> eller <cell>.`);
  return el.children.filter((c): c is MarkupElement => c.kind === "element");
}

/** Element som inte får ha innehåll (`<rule/>`, `<spacer/>` …). */
export function assertEmpty(el: MarkupElement): void {
  const [child] = elementChildren(el);
  if (child) throw new LayoutError(`Rad ${child.line}: <${el.name}> får inte innehålla <${child.name}>.`);
}

/** Fel för ett element som inte hör hemma i `parent`. */
export function unexpected(el: MarkupElement, parent: string, allowed: readonly string[]): LayoutError {
  return new LayoutError(`Rad ${el.line}: <${el.name}> är inte tillåtet i <${parent}> (tillåtet: ${allowed.map((a) => `<${a}>`).join(", ")}).`);
}
