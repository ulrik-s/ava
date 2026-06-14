/**
 * Integrationstest för `serveFetchHandler` (#83 steg 1c) — node:http-adaptern.
 * Startar en riktig server på en OS-tilldelad port och anropar den med en
 * node:http-klient (test-miljöns happy-dom-`fetch` blockerar cross-origin mot
 * 127.0.0.1). Verifierar Request-/Response-översättningen + 500 vid kast.
 */
import { once } from "node:events";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, afterEach } from "vitest-compat";
import { serveFetchHandler } from "@/lib/server/http/node-http-adapter";

let server: Server | undefined;
afterEach(() => { server?.close(); server = undefined; });

async function start(handler: (req: Request) => Promise<Response>): Promise<number> {
  server = serveFetchHandler(handler, { port: 0 });
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: string }

/** Liten node:http-klient (oberoende av happy-dom:s fetch). */
function call(
  port: number, path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({
          status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString(),
        }));
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

describe("serveFetchHandler", () => {
  it("GET: metod/headers/url → Request; Response → status/headers/body", async () => {
    const port = await start(async (req) =>
      new Response(JSON.stringify({
        method: req.method,
        path: new URL(req.url).pathname,
        auth: req.headers.get("authorization"),
      }), { status: 200, headers: { "content-type": "application/json", "x-test": "1" } }),
    );
    const res = await call(port, "/hello", { headers: { authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    expect(res.headers["x-test"]).toBe("1");
    const body = JSON.parse(res.body) as { method: string; path: string; auth: string };
    expect(body.method).toBe("GET");
    expect(body.path).toBe("/hello");
    expect(body.auth).toBe("Bearer t");
  });

  it("POST: bodyn vidarebefordras till handlern", async () => {
    const port = await start(async (req) => new Response(`echo:${await req.text()}`, { status: 201 }));
    const res = await call(port, "/x", { method: "POST", body: "payload" });
    expect(res.status).toBe(201);
    expect(res.body).toBe("echo:payload");
  });

  it("handler-kast → 500", async () => {
    const port = await start(async () => { throw new Error("boom"); });
    const res = await call(port, "/x");
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: "internal" });
  });
});
