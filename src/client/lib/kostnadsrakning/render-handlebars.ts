"use client";

/**
 * `renderHandlebars` — minimal Handlebars-kompatibel template-renderer
 * för kostnadsräknings-mallen (och liknande små mallar i AVA).
 *
 * Stöder:
 *   - `{{var}}` och `{{var.nested}}` (path-lookup med dot)
 *   - `{{#if var}}…{{/if}}` (truthy)
 *   - `{{#each list}}…{{/each}}` (iterera, item-context blir aktuell scope)
 *   - `{{list.length}}` (special: array-längd)
 *
 * Vi använder en custom mini-renderer istället för full `handlebars`-bundeln
 * eftersom byrå-mallarna är enkla och vi vill spara ~50 KB i klient-bundle.
 *
 * Pure, ingen DOM-åtkomst. Lätt att testa.
 */

interface Scope {
  readonly value: unknown;
  readonly parent?: Scope;
}

export function renderHandlebars(template: string, context: Record<string, unknown>): string {
  return renderWithScope(template, { value: context });
}

function renderWithScope(template: string, scope: Scope): string {
  // Process block-helpers först (each + if), sedan enkla variabler.
  // Vi gör det iterativt eftersom block kan vara nästlade.
  let out = template;
  out = processBlocks(out, scope, /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, expandEach);
  out = processBlocks(out, scope, /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, expandIf);
  return substituteVars(out, scope);
}

function processBlocks(
  src: string,
  scope: Scope,
  re: RegExp,
  expand: (key: string, body: string, scope: Scope) => string,
): string {
  let prev: string;
  let out = src;
  // Iterera tills inga fler matchningar — hanterar nästlade block
  do {
    prev = out;
    out = out.replace(re, (_m, key: string, body: string) => expand(key, body, scope));
  } while (out !== prev);
  return out;
}

function expandEach(key: string, body: string, scope: Scope): string {
  const list = lookup(scope, key);
  if (!Array.isArray(list)) return "";
  return list.map((item) => renderWithScope(body, { value: item, parent: scope })).join("");
}

function expandIf(key: string, body: string, scope: Scope): string {
  const v = lookup(scope, key);
  return isTruthy(v) ? renderWithScope(body, scope) : "";
}

function substituteVars(src: string, scope: Scope): string {
  return src.replace(/\{\{([\w.]+)\}\}/g, (_m, key: string) => {
    const v = lookup(scope, key);
    return v == null ? "" : escapeHtml(String(v));
  });
}

function lookup(scope: Scope | undefined, key: string): unknown {
  if (!scope) return undefined;
  const local = resolveInValue(scope.value, key);
  if (local !== undefined) return local;
  // Fall tillbaka på parent (Handlebars-semantik)
  return lookup(scope.parent, key);
}

function resolveInValue(value: unknown, key: string): unknown {
  const parts = key.split(".");
  let cur: unknown = value;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && p === "length") {
      cur = cur.length;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
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
