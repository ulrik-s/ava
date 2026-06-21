/**
 * `node-http-adapter` — monterar en fetch-standard `(Request) => Response`-
 * handler på en `node:http`-server (#83 steg 1c). Vald framför `Bun.serve` så
 * koden typkollar under rot-tsconfig:en (`types: []`, inga Bun-globaler) och
 * fungerar oavsett runtime.
 *
 * Servern lyssnar default på 127.0.0.1 — den är INTE tänkt att exponeras
 * direkt mot internet utan att sitta bakom nginx-fronten (ADR 0009), som
 * TLS-terminerar och proxar `/api/`.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";

type FetchHandler = (req: Request) => Promise<Response>;

/** Läs hela request-bodyn till en Buffer. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** node:http-headers (string | string[] | undefined) → fetch Headers. */
function toHeaders(raw: IncomingMessage["headers"]): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

/** node:http IncomingMessage → fetch Request. */
function toFetchRequest(req: IncomingMessage, body: Buffer): Request {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD" && body.length > 0;
  return new Request(url, {
    method,
    headers: toHeaders(req.headers),
    ...(hasBody ? { body: new Uint8Array(body) } : {}),
  });
}

/** Skriv en fetch Response till en node:http ServerResponse. */
async function writeFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function handle(handler: FetchHandler, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const request = toFetchRequest(req, await readBody(req));
    await writeFetchResponse(res, await handler(request));
  } catch {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "internal" }));
  }
}

export interface ServeOpts {
  port: number;
  /** Lyssna-adress. Default 127.0.0.1 (loopback; nginx proxar utifrån). */
  hostname?: string;
  /** TLS-material → https-server (ADR 0006: helperns lokala CA för Safari/add-in). */
  tls?: { cert: string; key: string };
  /**
   * Hanterar server-`error` (t.ex. EADDRINUSE). I `node:http` emittas listen-fel
   * ASYNKRONT som ett `error`-event — utan handler kraschar processen
   * (oträffbart av synkron try/catch). Default: logga till `console.error`.
   */
  onError?: (err: Error) => void;
}

/**
 * Starta en `node:http`(s)-server som serverar `handler`. Med `opts.tls` blir
 * det en https-server (annars http). Returnerar servern (`.close()` vid nedstängning).
 */
export function serveFetchHandler(handler: FetchHandler, opts: ServeOpts): Server {
  const onReq = (req: IncomingMessage, res: ServerResponse): void => { void handle(handler, req, res); };
  const server = opts.tls
    ? createHttpsServer({ cert: opts.tls.cert, key: opts.tls.key }, onReq)
    : createServer(onReq);
  server.on("error", (err: Error) => (opts.onError ?? ((e) => console.error(`serveFetchHandler: ${e.message}`)))(err));
  server.listen(opts.port, opts.hostname ?? "127.0.0.1");
  return server;
}
