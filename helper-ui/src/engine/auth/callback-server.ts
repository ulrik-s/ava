/**
 * Loopback-callback-server (RFC 8252, ADR 0028 §2) — fångar OAuth-redirecten
 * på `http://127.0.0.1:<port>/callback` efter att användaren godkänt i browsern.
 *
 * `parseCallback` (ren) validerar pathname + `state` (CSRF) och plockar `code`
 * → testbar utan att binda en port. `waitForCallback` binder en kortlivad
 * Bun-server, resolvar vid första giltiga callback och svarar användaren med en
 * "stäng fliken"-sida; timeout om inget kommer.
 */

import { serveFetchHandler } from "@/lib/shared/http/node-http-adapter";
import { log } from "../log.ts";

export type CallbackResult = { code: string } | { error: string };

/** Validera en inkommande callback-URL → code, eller ett fel. Ren funktion. */
export function parseCallback(rawUrl: string, expectedState: string): CallbackResult {
  let u: URL;
  try {
    u = new URL(rawUrl, "http://127.0.0.1");
  } catch {
    return { error: "invalid-url" };
  }
  if (u.pathname !== "/callback") return { error: "not-callback" };
  const err = u.searchParams.get("error");
  if (err) return { error: err };
  if (u.searchParams.get("state") !== expectedState) return { error: "state-mismatch" };
  const code = u.searchParams.get("code");
  if (!code) return { error: "missing-code" };
  return { code };
}

const SUCCESS_HTML = "<!doctype html><meta charset=utf-8><title>AVA Helper</title><body style=\"font-family:system-ui;padding:3rem;text-align:center\"><h2>✅ AVA Helper är ansluten</h2><p>Du kan stänga den här fliken.</p>";
const ERROR_HTML = "<!doctype html><meta charset=utf-8><title>AVA Helper</title><body style=\"font-family:system-ui;padding:3rem;text-align:center\"><h2>⚠️ Inloggningen misslyckades</h2><p>Stäng fliken och försök igen.</p>";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface WaitForCallbackDeps {
  /** Binder en HTTP-server; returnerar en stop-funktion. För test-injektion. */
  serve: (port: number, handler: (req: Request) => Response) => { stop: () => void };
  timeoutMs?: number;
}

const defaultServe: WaitForCallbackDeps["serve"] = (port, handler) => {
  const server = serveFetchHandler(async (req) => handler(req), { port, hostname: "127.0.0.1" });
  return { stop: () => server.close() };
};

/**
 * Starta callback-servern och vänta på en giltig redirect (rätt `state` + `code`).
 * Resolvar med koden, eller rejectar vid fel/timeout. Servern stängs alltid.
 */
export function waitForCallback(port: number, expectedState: string, deps: WaitForCallbackDeps = { serve: defaultServe }): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const handler = (req: Request): Response => {
      const result = parseCallback(req.url, expectedState);
      const ok = "code" in result;
      if (!settled && (ok || req.url.includes("/callback"))) {
        settled = true;
        queueMicrotask(() => {
          handle.stop();
          if (ok) resolve(result.code);
          else reject(new Error(`callback: ${(result as { error: string }).error}`));
        });
      }
      return new Response(ok ? SUCCESS_HTML : ERROR_HTML, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
    };
    const handle = deps.serve(port, handler);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      handle.stop();
      reject(new Error("callback: timeout"));
    }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref?.();
    log(`auth: väntar på callback på 127.0.0.1:${port}/callback`);
  });
}
