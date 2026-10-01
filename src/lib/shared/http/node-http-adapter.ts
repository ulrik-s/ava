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
import type { Socket } from "node:net";

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

/** Har klienten gått? Bun:s node:http sätter inte `res.destroyed` — socketen säger det i båda. */
function gone(res: ServerResponse, socket: Socket | null): boolean {
  return res.destroyed === true || socket?.destroyed === true;
}

/** Hur länge en ström får stå still (ingen `drain`) innan den ges upp. */
export const DEFAULT_STALL_TIMEOUT_MS = 60_000;

/**
 * Vänta tills socketen tar emot mer: `true`. Stängd (klienten gick) eller
 * stillastående längre än `stallMs`: `false`. Tidsgränsen behövs för en
 * klient som slutar läsa utan att stänga — utan den hade strömmen och filen
 * hängt kvar för alltid. (Bun:s node:http signalerar inte alltid ett avbrott:
 * efter en läst request-body skrivs bitarna till ingenting och källan läses
 * klart, utan att minnet växer.)
 */
function drained(res: ServerResponse, socket: Socket | null, stallMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean) => (): void => {
      clearTimeout(timer);
      res.off("drain", onDrain); res.off("close", onGone); socket?.off("close", onGone);
      resolve(ok);
    };
    const onDrain = finish(true);
    const onGone = finish(false);
    const timer = setTimeout(onGone, stallMs);
    res.on("drain", onDrain);
    // Node signalerar ett avbrott på svaret, Bun (ibland) bara på socketen.
    res.on("close", onGone);
    socket?.on("close", onGone);
  });
}

/** Skriv en bit; `false` om klienten gått eller strömmen stått still för länge. */
async function writeChunk(res: ServerResponse, socket: Socket | null, chunk: Uint8Array, stallMs: number): Promise<boolean> {
  if (gone(res, socket)) return false;
  return res.write(chunk) || drained(res, socket, stallMs);
}

/**
 * Strömma bodyn bit för bit med mottryck (#1431): en backup är databasen +
 * alla dokument och ska aldrig ligga i minnet. Går klienten avbryts läsningen
 * (källan stänger sin fil) och anslutningen stängs.
 */
async function pipeBody(res: ServerResponse, body: ReadableStream<Uint8Array>, stallMs: number): Promise<void> {
  const reader = body.getReader();
  const socket = res.socket;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(await writeChunk(res, socket, value, stallMs))) { await reader.cancel(); res.destroy(); return; }
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

/** Skriv en fetch Response till en node:http ServerResponse. */
async function writeFetchResponse(res: ServerResponse, response: Response, stallMs: number): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body) await pipeBody(res, response.body, stallMs);
  else res.end();
}

async function handle(handler: FetchHandler, req: IncomingMessage, res: ServerResponse, stallMs: number): Promise<void> {
  try {
    const request = toFetchRequest(req, await readBody(req));
    await writeFetchResponse(res, await handler(request), stallMs);
  } catch {
    // Mitt i en ström går statusen inte att ändra: bryt anslutningen, så att
    // klienten ser ett avbrott i stället för en till synes hel fil.
    if (res.headersSent) { res.destroy(); return; }
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
  /** Hur länge ett strömmande svar får stå still innan det ges upp. Default {@link DEFAULT_STALL_TIMEOUT_MS}. */
  stallTimeoutMs?: number;
}

/**
 * Starta en `node:http`(s)-server som serverar `handler`. Med `opts.tls` blir
 * det en https-server (annars http). Returnerar servern (`.close()` vid nedstängning).
 */
export function serveFetchHandler(handler: FetchHandler, opts: ServeOpts): Server {
  const stallMs = opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  const onReq = (req: IncomingMessage, res: ServerResponse): void => { void handle(handler, req, res, stallMs); };
  const server = opts.tls
    ? createHttpsServer({ cert: opts.tls.cert, key: opts.tls.key }, onReq)
    : createServer(onReq);
  server.on("error", (err: Error) => (opts.onError ?? ((e) => console.error(`serveFetchHandler: ${e.message}`)))(err));
  server.listen(opts.port, opts.hostname ?? "127.0.0.1");
  return server;
}
