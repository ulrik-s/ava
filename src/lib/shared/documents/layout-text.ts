/**
 * `<text>`s innehåll i layoutspråket (ADR 0042, tillägg #2255): löptext med
 * understrukna delar,
 *
 *   <text font="bold">Ange <u>endast fakturanummer</u> vid betalning tack!</text>
 *
 * `<u>` har inga attribut och får bara innehålla text. Blanktecken komprimeras
 * som i HTML — också över gränsen mellan delarna, så "Ange <u>endast</u>" ger
 * delarna "Ange " och "endast" (mellanslaget stryks inte under).
 */

import type { TextSpan } from "./layout-ast";
import { ATTRS, attrsOf } from "./layout-attrs";
import { LayoutError, type MarkupElement, type MarkupNode } from "./markup-parser";

/** Ett elements text utan komprimering; ett barnelement är ett fel. */
function rawText(el: MarkupElement, allowed: string): string {
  const child = el.children.find((c) => c.kind === "element");
  if (child?.kind === "element") throw new LayoutError(`Rad ${child.line}: <${el.name}> får bara innehålla ${allowed}, inte <${child.name}>.`);
  return el.children.map((c) => (c.kind === "text" ? c.text : "")).join("");
}

/** En nod i `<text>` som en del: text, eller `<u>` → understruken. */
function rawSpan(node: MarkupNode, parent: MarkupElement): TextSpan {
  if (node.kind === "text") return { text: node.text, underline: false };
  if (node.name !== "u") throw new LayoutError(`Rad ${node.line}: <${parent.name}> får bara innehålla text och <u>, inte <${node.name}>.`);
  attrsOf(ATTRS.u, node);
  return { text: rawText(node, "text"), underline: true };
}

/** Lägg till en del; slå ihop med föregående om understrykningen är densamma. */
function push(out: TextSpan[], span: TextSpan): void {
  const last = out.at(-1);
  if (last?.underline === span.underline) last.text += span.text;
  else out.push({ ...span });
}

/** Komprimera blanktecken över delarna och trimma början och slut. */
function collapse(raw: readonly TextSpan[]): TextSpan[] {
  const out: TextSpan[] = [];
  let afterSpace = true;
  for (const span of raw) {
    const squeezed = span.text.replace(/\s+/g, " ");
    const text: string = afterSpace && squeezed.startsWith(" ") ? squeezed.slice(1) : squeezed;
    if (text === "") continue;
    afterSpace = text.endsWith(" ");
    push(out, { text, underline: span.underline });
  }
  return out;
}

/** Ta bort det avslutande mellanslaget (och en del som då blir tom). */
function trimEnd(spans: TextSpan[]): TextSpan[] {
  const last = spans.at(-1);
  if (!last?.text.endsWith(" ")) return spans;
  const text = last.text.slice(0, -1);
  return text === "" ? spans.slice(0, -1) : [...spans.slice(0, -1), { ...last, text }];
}

/** `<text>`s delar — minst en (tom text ger en tom del). */
export function textSpans(el: MarkupElement): TextSpan[] {
  const spans = trimEnd(collapse(el.children.map((c) => rawSpan(c, el))));
  return spans.length > 0 ? spans : [{ text: "", underline: false }];
}
