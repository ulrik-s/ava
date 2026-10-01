/**
 * Mätning på HTTP-nivå (#1366): varje anrop den riktiga synk-klienten gör
 * (`httpBatchLink` → `fetch`) tidtas och klassas — samma väg som webbläsaren.
 *
 * En batch (`/api/trpc/a,b?batch=1`) räknas som ett utfall per anrop: tRPC
 * svarar 207 när bara några av dem fallerade, och felet syns då bara i
 * svarskroppen — utan det här skulle ett 500 i en batch passera som lyckat.
 */

import { z } from "zod";
import type { LatencyRecorder } from "./stats";

/** `/api/trpc/sync.push,sync.pull?batch=1` → `["sync.push", "sync.pull"]`. */
export function operationsOf(url: string): string[] {
  const path = new URL(url, "http://x").pathname;
  const marker = "/api/trpc/";
  const at = path.indexOf(marker);
  if (at < 0) return [path];
  return decodeURIComponent(path.slice(at + marker.length)).split(",");
}

/** Ett tRPC-svar (superjson): `{ result }` eller `{ error: { json: { data: { code, httpStatus } } } }`. */
const trpcItem = z.object({
  error: z.object({
    json: z.object({ data: z.object({ code: z.string().optional(), httpStatus: z.number().optional() }).optional() }).optional(),
  }).optional(),
});

/** Utfallet för ett anrop. */
export interface OpOutcome {
  op: string;
  status: number;
  /** `500:INTERNAL_SERVER_ERROR` o.d.; utelämnad = lyckat. */
  error?: string;
}

function parseItems(body: string): unknown[] | null {
  try {
    const json: unknown = JSON.parse(body);
    return Array.isArray(json) ? json : [json];
  } catch {
    return null;
  }
}

function itemOutcome(op: string, status: number, item: unknown): OpOutcome {
  const parsed = trpcItem.safeParse(item);
  const error = parsed.success ? parsed.data.error : undefined;
  if (!error) return { op, status };
  const data = error.json?.data;
  const itemStatus = data?.httpStatus ?? status;
  return { op, status: itemStatus, error: data?.code ? `${itemStatus}:${data.code}` : String(itemStatus) };
}

/** Ett utfall per anrop ur ett (batch-)svar. Okänd kropp → svarets status för alla. */
export function outcomesOf(ops: readonly string[], status: number, body: string): OpOutcome[] {
  const items = parseItems(body);
  if (!items || items.length !== ops.length) {
    return ops.map((op) => (status >= 200 && status < 300 ? { op, status } : { op, status, error: String(status) }));
  }
  return ops.map((op, i) => itemOutcome(op, status, items[i]));
}

/** Det minsta av `fetch` som klienten behöver (DOM-kompatibelt). */
export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface TimedFetchDeps {
  recorder: LatencyRecorder;
  /** Identiteten: proxyns header (oauth2-proxy, `AVA_IDENTITY=forwarded`). */
  email: string;
  /** Nätet av → `fetch` kastar som en webbläsare utan nät. */
  isOnline: () => boolean;
  fetch?: FetchFn;
  now?: () => number;
}

/** Fel som en webbläsare utan nät ger (`TypeError: Failed to fetch`). */
export class OfflineError extends TypeError {
  constructor() {
    super("Failed to fetch (lasttest: offline)");
  }
}

/**
 * En `fetch` som sätter identiteten, tidtar hela svaret (inklusive kroppen)
 * och registrerar status och felkod per anrop. Kroppen läses här och läggs i
 * ett nytt `Response`, så klienten ser exakt samma svar.
 */
export function timedFetch(deps: TimedFetchDeps): FetchFn {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => performance.now());
  return async (input, init) => {
    if (!deps.isOnline()) throw new OfflineError();
    const ops = operationsOf(String(input));
    const headers = new Headers(init?.headers);
    headers.set("X-Auth-Request-Email", deps.email);
    const start = now();
    let res: Response;
    try {
      res = await doFetch(input, { ...init, headers });
    } catch (err) {
      for (const op of ops) deps.recorder.record({ op, ms: now() - start, status: 0, error: "NETWORK" });
      throw err;
    }
    const body = await res.text();
    const ms = now() - start;
    for (const o of outcomesOf(ops, res.status, body)) deps.recorder.record({ ...o, ms });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}
