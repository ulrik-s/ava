"use client";

/**
 * `renderHandlebars` — minimal Handlebars-kompatibel template-renderer
 * för AVA:s mallar (kostnadsräkning, byrå-egna dokumentmallar).
 *
 * Stöder:
 *   - `{{var}}` / `{{ var }}` / `{{var.nested}}` (path-lookup, trim:ar mellanrum)
 *   - `{{#if x}}…{{else}}…{{/if}}` (truthy + else-gren)
 *   - `{{#each list}}…{{/each}}` (item blir aktuell scope, parent-fallback)
 *   - `{{list.length}}`
 *   - godtycklig nästling av if/each
 *
 * Arkitektur (SOLID — separata ansvar):
 *   1. `tokenize` → text- + mustache-tokens
 *   2. `parse`    → AST med korrekt block-nästling (stack-baserat)
 *   3. `renderNodes` → ren rendering mot scope
 *
 * Custom mini-renderer istället för full `handlebars`-bundle (~50 KB).
 * Pure, ingen DOM. Lätt att testa.
 */

interface Scope {
  readonly value: unknown;
  readonly parent?: Scope;
}

// ── AST ──────────────────────────────────────────────────────────────
type Node =
  | { kind: "text"; text: string }
  | { kind: "var"; path: string }
  | { kind: "if"; path: string; then: Node[]; else: Node[] }
  | { kind: "each"; path: string; body: Node[] };

type Token =
  | { t: "text"; v: string }
  | { t: "var"; v: string }
  | { t: "if"; v: string }
  | { t: "each"; v: string }
  | { t: "else" }
  | { t: "endif" }
  | { t: "endeach" };

export function renderHandlebars(template: string, context: Record<string, unknown>): string {
  const nodes = parse(tokenize(template));
  return renderNodes(nodes, { value: context });
}

// ── 1. Tokenize ──────────────────────────────────────────────────────
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) tokens.push({ t: "text", v: src.slice(last, m.index) });
    tokens.push(classify(m[1].trim()));
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push({ t: "text", v: src.slice(last) });
  return tokens;
}

function classify(inner: string): Token {
  if (inner === "else") return { t: "else" };
  if (inner === "/if") return { t: "endif" };
  if (inner === "/each") return { t: "endeach" };
  const ifM = inner.match(/^#if\s+(.+)$/);
  if (ifM) return { t: "if", v: ifM[1].trim() };
  const eachM = inner.match(/^#each\s+(.+)$/);
  if (eachM) return { t: "each", v: eachM[1].trim() };
  return { t: "var", v: inner };
}

// ── 2. Parse → AST ───────────────────────────────────────────────────
function parse(tokens: Token[]): Node[] {
  let pos = 0;

  // eslint-disable-next-line complexity
  function parseUntil(stop: ("endif" | "endeach" | "else")[]): { nodes: Node[]; stopped: Token | null } {
    const nodes: Node[] = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if ((tok.t === "endif" || tok.t === "endeach" || tok.t === "else") && stop.includes(tok.t)) {
        return { nodes, stopped: tok };
      }
      pos++;
      if (tok.t === "text") nodes.push({ kind: "text", text: tok.v });
      else if (tok.t === "var") nodes.push({ kind: "var", path: tok.v });
      else if (tok.t === "if") {
        const thenBranch = parseUntil(["else", "endif"]);
        let elseNodes: Node[] = [];
        if (thenBranch.stopped?.t === "else") {
          pos++; // konsumera else
          elseNodes = parseUntil(["endif"]).nodes;
        }
        pos++; // konsumera /if
        nodes.push({ kind: "if", path: tok.v, then: thenBranch.nodes, else: elseNodes });
      } else if (tok.t === "each") {
        const body = parseUntil(["endeach"]).nodes;
        pos++; // konsumera /each
        nodes.push({ kind: "each", path: tok.v, body });
      }
      // ensamma else/endif/endeach utanför block ignoreras
    }
    return { nodes, stopped: null };
  }

  return parseUntil([]).nodes;
}

// ── 3. Render ────────────────────────────────────────────────────────
// eslint-disable-next-line complexity
function renderNodes(nodes: Node[], scope: Scope): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") out += n.text;
    else if (n.kind === "var") {
      const v = lookup(scope, n.path);
      out += v == null ? "" : escapeHtml(String(v));
    } else if (n.kind === "if") {
      out += isTruthy(lookup(scope, n.path))
        ? renderNodes(n.then, scope)
        : renderNodes(n.else, scope);
    } else if (n.kind === "each") {
      const list = lookup(scope, n.path);
      if (Array.isArray(list)) {
        for (const item of list) out += renderNodes(n.body, { value: item, parent: scope });
      }
    }
  }
  return out;
}

// ── Scope-lookup ─────────────────────────────────────────────────────
function lookup(scope: Scope | undefined, key: string): unknown {
  if (!scope) return undefined;
  const local = resolveInValue(scope.value, key);
  if (local !== undefined) return local;
  return lookup(scope.parent, key);
}

function resolveInValue(value: unknown, key: string): unknown {
  const parts = key.split(".");
  let cur: unknown = value;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && p === "length") cur = cur.length;
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

function isTruthy(v: unknown): boolean {
  if (v == null || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
