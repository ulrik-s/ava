/**
 * HTTP-API:t webbappen pratar med (127.0.0.1:48761). Port av Go:s
 * server-paket.
 *
 *   GET  /ping          → "ava-helper <version>\n" (text)
 *   GET  /version       → JSON { current, updateAvailable }
 *   POST /open          → ladda ner → spawn default-app → watch+upload
 *   POST /compose-mail  → skriv bilaga → öppna mail-app
 *   POST /check-update  → trigga omedelbar self-update-kontroll
 *
 * Säkerhet: lyssnar bara på localhost; CORS-whitelist (localhost-portar
 * + *.github.io + custom via AVA_HELPER_ORIGINS); inga endpoints som
 * exekverar godtyckliga kommandon.
 */

import {
  formatPing,
  isAllowedOrigin,
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
  /** Trigga self-update. undefined → endpointen svarar 500 (ej konfigurerad). */
  onCheckUpdate?: () => void;
}

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

async function route(req: Request, deps: ServerDeps): Promise<Response> {
  const { pathname } = new URL(req.url);
  switch (pathname) {
    case "/ping":
      return new Response(formatPing(deps.version), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    case "/version":
      return json({ current: deps.version, updateAvailable: false } satisfies HelperVersionResponse);
    case "/open":
      return (deps.onOpen ?? handleOpen)(req);
    case "/compose-mail":
      return (deps.onComposeMail ?? handleComposeMail)(req);
    case "/check-update":
      return handleCheckUpdate(deps);
    default:
      return textError(404, "not found");
  }
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
