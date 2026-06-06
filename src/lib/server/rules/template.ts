/**
 * Liten templating-motor för regel-steg.
 *
 * Stöd:
 *   - `{{var.path.0.field}}` — slå upp via context.var (med dot- och index-notation)
 *   - `{{event.ts}}` — direkt accesss till event-fält
 *   - `{{event.payload.matterId}}` — nested payload-fält
 *   - `{{var.foo | upper}}` — pipe-filter (bara `upper`, `lower`, `date`, `json` i v1)
 *
 * Vi använder INTE Handlebars eller liknande — vi behöver bara värdesubstitution
 * och vi vill ha noll auto-escapning. Templates kommer från regelförfattaren
 * (vendor eller byrå-admin), inte från slutanvändare.
 */

/** Hämta ett värde via dotterminerad path. `events.0.id` läses som arr[0].id. */
export function lookup(root: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    const asArr = Array.isArray(cur);
    const key = asArr && /^\d+$/.test(p) ? Number(p) : p;
    cur = (cur as Record<string | number, unknown>)[key as never];
  }
  return cur;
}

const FILTERS: Record<string, (v: unknown) => unknown> = {
  upper: (v) => String(v ?? "").toUpperCase(),
  lower: (v) => String(v ?? "").toLowerCase(),
  date: (v) => {
    try { return new Date(String(v)).toISOString().slice(0, 10); } catch { return String(v ?? ""); }
  },
  json: (v) => JSON.stringify(v),
};

/**
 * Substituera alla `{{...}}` i en sträng. Om hela strängen är en single
 * `{{x}}` returneras värdet *unwrapped* (så att man kan templatera in
 * objekt och nummer, inte bara strängar). Annars konkateneras till sträng.
 */
export function template(input: string, ctx: Record<string, unknown>): unknown {
  const SINGLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  const single = input.match(SINGLE);
  if (single) return resolveOne(single[1] ?? "", ctx);

  return input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr) => {
    const v = resolveOne(expr, ctx);
    return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

function resolveOne(expr: string, ctx: Record<string, unknown>): unknown {
  const [pathRaw = "", ...filters] = expr.split("|").map((s) => s.trim());
  let v = lookup(ctx, pathRaw);
  for (const f of filters) {
    const fn = FILTERS[f];
    if (fn) v = fn(v);
  }
  return v;
}

/**
 * Recursivt templatera alla strängvärden i ett objekt. Används för att
 * substituera variabler i step-payloads (`{ to: "{{event.payload.email}}" }`).
 */
export function templateValue<T>(input: T, ctx: Record<string, unknown>): T {
  if (typeof input === "string") return template(input, ctx) as T;
  if (Array.isArray(input)) return input.map((v) => templateValue(v, ctx)) as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = templateValue(v, ctx);
    }
    return out as T;
  }
  return input;
}
