/**
 * Sessionsfrågan (#1245, #1351): bara oauth2-proxys egna svar räknas som
 * besked. Omdirigeringar, captive portals, timeouts och andra 4xx är "vet
 * inte" — då avgör graceperioden, inte en hård omdirigering.
 */
import { describe, expect, it } from "vitest-compat";
import { OIDC_USERINFO_PATH, probeSession, SESSION_PROBE_TIMEOUT_MS } from "@/lib/client/auth/session-probe";
import { fetchFake, jsonResponse } from "../../../helpers/fetch-fake";

const respond = (res: Response) => ({ fetchFn: fetchFake(async () => res) });
const html = (status: number) => new Response("<!doctype html><title>Wi-Fi</title>", { status, headers: { "content-type": "text/html" } });

describe("probeSession", () => {
  it("inloggad: email + namn ur userinfo, utan att följa omdirigeringar och med en avbrytbar signal", async () => {
    const fetchFn = fetchFake(async (path, init) => {
      expect(path).toBe(OIDC_USERINFO_PATH);
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse(200, { email: "anna@byra.se", user: "anna", preferredUsername: "Anna A" });
    });
    expect(await probeSession({ fetchFn })).toEqual({ kind: "authenticated", claims: { email: "anna@byra.se", subject: "", issuer: "", name: "Anna A" } });
  });

  it("namn faller tillbaka på user när preferredUsername saknas", async () => {
    expect(await probeSession(respond(jsonResponse(200, { email: "x@y.se", user: "x" })))).toMatchObject({ kind: "authenticated", claims: { name: "x" } });
  });

  it("401 är proxyns besked: utloggad", async () => {
    expect(await probeSession(respond(jsonResponse(401, {})))).toEqual({ kind: "signed-out" });
  });

  it("404: ingen oauth2-proxy i driften", async () => {
    expect(await probeSession(respond(jsonResponse(404, {})))).toEqual({ kind: "absent" });
  });

  it("en omdirigering (opaqueredirect eller 3xx) är inget besked", async () => {
    const opaque = new Response(null);
    Object.defineProperty(opaque, "type", { value: "opaqueredirect" });
    expect(await probeSession(respond(opaque))).toEqual({ kind: "unreachable", reason: "redirect" });
    expect(await probeSession(respond(new Response(null, { status: 302 })))).toEqual({ kind: "unreachable", reason: "redirect" });
  });

  it("andra 4xx (403, 407, 429) är inget besked", async () => {
    for (const status of [403, 407, 429]) {
      expect(await probeSession(respond(jsonResponse(status, {})))).toEqual({ kind: "unreachable", reason: "unexpected-status" });
    }
  });

  it("5xx: proxyn/IdP:n nås inte", async () => {
    expect(await probeSession(respond(jsonResponse(502, {})))).toEqual({ kind: "unreachable", reason: "server-error" });
  });

  it("captive portal (HTML 200), JSON utan email eller trasig JSON → inte inloggad, men inte heller utloggad", async () => {
    expect(await probeSession(respond(html(200)))).toEqual({ kind: "unreachable", reason: "unexpected-content" });
    expect(await probeSession(respond(new Response("ok", { status: 200 })))).toEqual({ kind: "unreachable", reason: "unexpected-content" });
    expect(await probeSession(respond(jsonResponse(200, { user: "x" })))).toEqual({ kind: "unreachable", reason: "unexpected-content" });
    expect(await probeSession(respond(jsonResponse(200, "inte ett objekt")))).toEqual({ kind: "unreachable", reason: "unexpected-content" });
    const broken = new Response("{", { status: 200, headers: { "content-type": "application/json" } });
    expect(await probeSession(respond(broken))).toEqual({ kind: "unreachable", reason: "unexpected-content" });
  });

  it("nätverksfel → nås inte", async () => {
    const fetchFn = fetchFake(async () => { throw new TypeError("Failed to fetch"); });
    expect(await probeSession({ fetchFn })).toEqual({ kind: "unreachable", reason: "network" });
  });

  it("inget svar inom tidsgränsen → nås inte (appstarten hänger aldrig)", async () => {
    const fetchFn = fetchFake((_path, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const started = Date.now();
    expect(await probeSession({ fetchFn, timeoutMs: 20 })).toEqual({ kind: "unreachable", reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("default-tidsgränsen är 3 s", () => {
    expect(SESSION_PROBE_TIMEOUT_MS).toBe(3_000);
  });

  it("utan injicerad fetch används den globala", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = fetchFake(async () => jsonResponse(401, {}));
    try {
      expect(await probeSession()).toEqual({ kind: "signed-out" });
    } finally {
      globalThis.fetch = original;
    }
  });
});
