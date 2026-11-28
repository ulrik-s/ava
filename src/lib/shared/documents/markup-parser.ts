/**
 * Tolken för dokumentmotorns layoutspråk (ADR 0042): en liten, strikt
 * XML-delmängd — element, attribut inom "…" eller '…', text och kommentarer.
 * Inga DOCTYPE, CDATA eller processinstruktioner.
 *
 * Mallens värden escapas av Handlebars (`&amp;`, `&lt;`, `&quot;`, `&#x27;` …)
 * innan de når hit, så ett värde kan aldrig bli ett element. Tolken avkodar
 * entiteterna tillbaka till text. Ett fristående `&` som inte inleder en känd
 * entitet står kvar som tecken, så mallförfattaren slipper skriva `&amp;`.
 *
 * Resultatet är ett generiskt träd; vilka element och attribut som är giltiga
 * avgör `buildLayout` (zod).
 */

/** Ett element i layoutmarkeringen. `line` är radnumret i den renderade mallen. */
export interface MarkupElement {
  kind: "element";
  name: string;
  attrs: Readonly<Record<string, string>>;
  children: MarkupNode[];
  line: number;
}

/** En textnod, med entiteterna avkodade. */
export interface MarkupText {
  kind: "text";
  text: string;
  line: number;
}

/** En nod i layoutmarkeringen. */
export type MarkupNode = MarkupElement | MarkupText;

/** Fel i en mall eller dess layoutmarkering — meddelandet visas för mallförfattaren. */
export class LayoutError extends Error {
  override readonly name = "LayoutError";
}

const NAME = "[a-z][a-z0-9-]*";
const ATTR = `${NAME}\\s*=\\s*(?:"[^"]*"|'[^']*')`;
/** En token: kommentar | sluttagg | starttagg | text | ett ensamt `<`. */
const TOKEN = new RegExp(`<!--[\\s\\S]*?-->|</(${NAME})\\s*>|<(${NAME})((?:\\s+${ATTR})*)\\s*(/?)>|[^<]+|<`, "g");
const ATTR_RE = new RegExp(`(${NAME})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "g");

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Avkoda en entitet (`amp`, `#39`, `#x27`) — `undefined` om den är okänd. */
function entity(body: string): string | undefined {
  const named = NAMED_ENTITIES[body];
  if (named !== undefined) return named;
  const code = body.startsWith("#x") ? Number.parseInt(body.slice(2), 16) : body.startsWith("#") ? Number.parseInt(body.slice(1), 10) : Number.NaN;
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}

/** Avkoda XML-entiteterna i en text eller ett attributvärde. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => entity(body) ?? whole);
}


function parseAttrs(raw: string, name: string, line: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) {
    const key = m[1] ?? "";
    if (Object.hasOwn(attrs, key)) throw new LayoutError(`Rad ${line}: <${name}> har attributet "${key}" två gånger.`);
    attrs[key] = decodeEntities(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/** Tolkningens tillstånd: stacken av öppna element (yttersta först) och radräknaren. */
interface ParseState {
  source: string;
  /** Behållaren för rotelementet — namnet "#root" kan aldrig stängas av en tagg. */
  container: MarkupElement;
  stack: MarkupElement[];
  /** Raden vid `pos` — räknas fram stegvis så tolkningen förblir linjär. */
  line: number;
  pos: number;
}

function lineAt(state: ParseState, index: number): number {
  for (let i = state.pos; i < index; i++) if (state.source.charCodeAt(i) === 10) state.line++;
  state.pos = index;
  return state.line;
}

/** Det innersta öppna elementet (behållaren när inget är öppet). */
function top(state: ParseState): MarkupElement {
  return state.stack.at(-1) ?? state.container;
}

function closeTag(state: ParseState, name: string, line: number): void {
  const current = top(state);
  if (current.name !== name) {
    throw new LayoutError(`Rad ${line}: </${name}> stänger inget öppet <${name}> (öppet element: <${current.name}>, rad ${current.line}).`);
  }
  state.stack.pop();
}

function openTag(state: ParseState, m: RegExpMatchArray, line: number): void {
  const name = m[2] ?? "";
  const element: MarkupElement = { kind: "element", name, attrs: parseAttrs(m[3] ?? "", name, line), children: [], line };
  top(state).children.push(element);
  if (m[4] !== "/") state.stack.push(element);
}

function consume(state: ParseState, m: RegExpMatchArray): void {
  const whole = m[0];
  const line = lineAt(state, m.index ?? 0);
  if (whole.startsWith("<!--")) return;
  if (m[1] !== undefined) return closeTag(state, m[1], line);
  if (m[2] !== undefined) return openTag(state, m, line);
  if (whole === "<") throw new LayoutError(`Rad ${line}: ett "<" som inte inleder ett element. Skriv &lt; för tecknet.`);
  top(state).children.push({ kind: "text", text: decodeEntities(whole), line });
}

/** Rotens enda element; text utanför det får bara vara blanktecken. */
function rootOf(container: MarkupElement): MarkupElement {
  const stray = container.children.find((c) => c.kind === "text" && c.text.trim() !== "");
  if (stray) throw new LayoutError(`Rad ${stray.line}: text utanför rotelementet.`);
  const elements = container.children.filter((c): c is MarkupElement => c.kind === "element");
  const [root, extra] = elements;
  if (!root) throw new LayoutError("Mallen gav ingen layoutmarkering (inget rotelement).");
  if (extra) throw new LayoutError(`Rad ${extra.line}: bara ett rotelement är tillåtet (<${root.name}> finns redan).`);
  return root;
}

/**
 * Tolka layoutmarkering till ett elementträd. Kastar `LayoutError` med radnummer
 * vid felaktig syntax (ostängda eller felnästlade element, ensamma `<`).
 */
export function parseMarkup(source: string): MarkupElement {
  const container: MarkupElement = { kind: "element", name: "#root", attrs: {}, children: [], line: 1 };
  const state: ParseState = { source, container, stack: [], line: 1, pos: 0 };
  for (const m of source.matchAll(TOKEN)) consume(state, m);
  const open = state.stack.at(-1);
  if (open) throw new LayoutError(`Rad ${open.line}: <${open.name}> stängs aldrig.`);
  return rootOf(container);
}
