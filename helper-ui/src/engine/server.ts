/**
 * HTTP-API:t webbappen pratar med (127.0.0.1:48761). Port av Go:s
 * server-paket.
 *
 *   GET  /ping          → "ava-helper <version>\n" (text)
 *   GET  /version       → JSON { current, updateAvailable }
 *   POST /open          → ladda ner → spawn default-app → watch+upload
 *   POST /compose-mail  → skriv bilaga → öppna mail-app
 *   POST /check-update  → trigga omedelbar uppdaterings-kontroll (notis, ADR 0030)
 *   GET  /status        → JSON ögonblicksbild av upload-kön (ADR 0028 §8)
 *   POST /content       → dokument-bytes ur durabla cachen (ADR 0028 §3/§5)
 *   POST /config        → auto-konfigurering från web-appen (ADR 0029)
 *
 * Säkerhet: lyssnar bara på localhost; CORS-whitelist (localhost-portar
 * + *.github.io + custom via AVA_HELPER_ORIGINS); inga endpoints som
 * exekverar godtyckliga kommandon.
 */

import {
  formatPing,
  isAllowedOrigin,
  type HelperStatusResponse,
  type HelperVersionResponse,
} from "@/lib/shared/helper/protocol";
import { handleComposeMail } from "./compose-mail.ts";
import { json, textError } from "./http.ts";
import { handleOpen } from "./open.ts";

export interface ServerDeps {
  version: string;
  /** Extra tillåtna origins (från AVA_HELPER_ORIGINS). */
  extraOrigins?: readonly string[];
  onOpen?: (req: Request) => Promise<Response>;
  onComposeMail?: (req: Request) => Promise<Response>;
  /** Trigga uppdaterings-kontroll. undefined → endpointen svarar 500 (ej konfigurerad). */
  onCheckUpdate?: () => void;
  /** Finns en nyare release? Speglas i `GET /version`. undefined → false. */
  updateAvailable?: () => boolean;
  /** Ögonblicksbild av upload-kön. undefined → tom kö (kön avstängd). */
  onStatus?: () => HelperStatusResponse;
  /** Leverera dokument-bytes (POST /content). undefined → 503 (ej konfigurerad). */
  onContent?: (req: Request) => Promise<Response>;
  /** Auto-konfigurering från web-appen (POST /config). undefined → 503. */
  onConfig?: (req: Request) => Promise<Response>;
}

const EMPTY_STATUS: HelperStatusResponse = { pending: 0, conflict: 0, total: 0, entries: [] };

/** Bygg en fetch-handler (testbar utan att binda en port). */
export function createHandler(deps: ServerDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("Origin") ?? "";
    const allowed = isAllowedOrigin(origin, deps.extraOrigins ?? []);
    if (req.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), origin, allowed);
    }
    const res = await route(req, deps);
    return withCors(res, origin, allowed);
  };
}

/**
 * Dispatch-tabell pathname → hanterare. Tabell i st.f. switch håller `route`
 * platt (cyklomatisk komplexitet ≤ 8) när endpoints växer; varje hanterare
 * bär sin egen lilla logik.
 */
const ROUTES: Record<string, (req: Request, deps: ServerDeps) => Response | Promise<Response>> = {
  "/ping": (_req, deps) =>
    new Response(formatPing(deps.version), { headers: { "Content-Type": "text/plain; charset=utf-8" } }),
  "/version": (_req, deps) =>
    json({ current: deps.version, updateAvailable: deps.updateAvailable?.() ?? false } satisfies HelperVersionResponse),
  "/open": (req, deps) => (deps.onOpen ?? handleOpen)(req),
  "/compose-mail": (req, deps) => (deps.onComposeMail ?? handleComposeMail)(req),
  "/check-update": (_req, deps) => handleCheckUpdate(deps),
  "/status": (_req, deps) => json(deps.onStatus?.() ?? EMPTY_STATUS),
  "/content": (req, deps) => deps.onContent?.(req) ?? textError(503, "content store not configured"),
  "/config": (req, deps) => deps.onConfig?.(req) ?? textError(503, "config endpoint not configured"),
};

async function route(req: Request, deps: ServerDeps): Promise<Response> {
  const { pathname } = new URL(req.url);
  const handler = ROUTES[pathname];
  return handler ? handler(req, deps) : textError(404, "not found");
}

function handleCheckUpdate(deps: ServerDeps): Response {
  if (deps.onCheckUpdate === undefined) {
    return textError(500, "update not configured");
  }
  deps.onCheckUpdate(); // async fire-and-forget
  return new Response("update check triggered\n", {
    status: 202,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function withCors(res: Response, origin: string, allowed: boolean): Response {
  if (allowed) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  return res;
}
