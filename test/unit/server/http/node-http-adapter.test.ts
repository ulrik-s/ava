/**
 * Integrationstest för `serveFetchHandler` (#83 steg 1c) — node:http-adaptern.
 * Startar en riktig server på en OS-tilldelad port och anropar den med en
 * node:http-klient (test-miljöns happy-dom-`fetch` blockerar cross-origin mot
 * 127.0.0.1). Verifierar Request-/Response-översättningen + 500 vid kast.
 */
import { once } from "node:events";
import { request, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { describe, it, expect, afterEach } from "vitest-compat";
import { serveFetchHandler } from "@/lib/shared/http/node-http-adapter";

let server: Server | undefined;
afterEach(() => { server?.close(); server = undefined; });

async function start(handler: (req: Request) => Promise<Response>, extra: { stallTimeoutMs?: number } = {}): Promise<number> {
  server = serveFetchHandler(handler, { port: 0, ...extra });
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

  it("port upptagen → onError (async listen-fel kraschar inte)", async () => {
    const port = await start(async () => new Response("ok"));
    let captured: Error | undefined;
    // Andra servern på samma port → EADDRINUSE emittas asynkront som 'error'.
    const second = serveFetchHandler(async () => new Response("x"), {
      port,
      onError: (err) => { captured = err; },
    });
    await once(second, "error");
    expect(captured).toBeInstanceOf(Error);
    second.close();
  });
});

describe("serveFetchHandler — strömmande svar (#1431)", () => {
  it("en body i många bitar kommer fram hel", async () => {
    const chunks = Array.from({ length: 50 }, (_, i) => `del-${i};`);
    const port = await start(async () => new Response(new ReadableStream<Uint8Array>({
      start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); },
    })));
    expect((await call(port, "/x")).body).toBe(chunks.join(""));
  });

  it("stor body med mottryck kommer fram hel", async () => {
    const big = new Uint8Array(8 * 1024 * 1024).fill(65);
    const port = await start(async () => new Response(big));
    expect((await call(port, "/x")).body.length).toBe(big.length);
  });

  it("svar utan body (204)", async () => {
    const port = await start(async () => new Response(null, { status: 204 }));
    const res = await call(port, "/x");
    expect(res.status).toBe(204);
    expect(res.body).toBe("");
  });

  /** En källa som (som en fil) läser asynkront, `total` bitar, och säger när den är klar eller avbruten. */
  function slowSource(total: number) {
    const state = { pulls: 0, cancelled: false, finished: false };
    const chunk = new Uint8Array(256 * 1024);
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        await new Promise((r) => setTimeout(r, 1));
        if (++state.pulls > total) { state.finished = true; c.close(); return; }
        c.enqueue(chunk);
      },
      cancel() { state.cancelled = true; },
    });
    return { state, body };
  }

  async function until(cond: () => boolean): Promise<void> {
    for (let i = 0; i < 150 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
  }

  it("klienten slutar läsa: strömmen ges upp efter tidsgränsen och källan avbryts", async () => {
    const src = slowSource(10_000);
    const port = await start(async () => new Response(src.body), { stallTimeoutMs: 200 });
    // En rå socket som skickar en request och sedan aldrig läser svaret.
    const sock = connect(port, "127.0.0.1", () => { sock.write("GET /x HTTP/1.1\r\nHost: x\r\n\r\n"); sock.pause(); });
    sock.on("error", () => undefined);
    await until(() => src.state.cancelled);
    expect(src.state.cancelled).toBe(true);
    sock.destroy();
  });

  it("klienten går mitt i: servern hänger inte (källan avbryts eller läses klart)", async () => {
    const src = slowSource(40);
    const port = await start(async () => new Response(src.body), { stallTimeoutMs: 200 });
    await new Promise<void>((resolve) => {
      const req = request({ host: "127.0.0.1", port, path: "/x" }, (res) => {
        res.once("data", () => { req.destroy(); resolve(); });
      });
      req.on("error", () => resolve());
      req.end();
    });
    await until(() => src.state.cancelled || src.state.finished);
    expect(src.state.cancelled || src.state.finished).toBe(true);
  });

  it("källan fallerar mitt i: anslutningen bryts i stället för en till synes hel fil", async () => {
    const port = await start(async () => new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode("början")); },
      pull(c) { c.error(new Error("disken")); },
    })));
    const outcome = await new Promise<string>((resolve) => {
      const req = request({ host: "127.0.0.1", port, path: "/x" }, (res) => {
        res.on("data", () => undefined);
        res.on("end", () => resolve("end"));
        res.on("error", () => resolve("aborted"));
        res.on("aborted", () => resolve("aborted"));
      });
      req.on("error", () => resolve("aborted"));
      req.end();
    });
    expect(outcome).toBe("aborted");
  });
});
