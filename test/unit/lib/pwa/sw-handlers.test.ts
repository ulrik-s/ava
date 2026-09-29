/**
 * `createSwHandlers` (#1240) — service workerns install/activate/fetch-logik mot
 * en fejkad Cache Storage och ett fejkat nät.
 *
 * Det som skyddas:
 *   - install förcachar HELA app-skalet eller misslyckas (hellre ingen ny
 *     version än en halv som inte startar offline),
 *   - en omdirigering (utgången session → IdP) cachas aldrig som en sida,
 *   - activate städar bara våra egna gamla versioner,
 *   - offline serveras skalet ur cache; runtime-id:n får __shell__-sidan,
 *   - data (/api, demo-seed) rörs aldrig.
 */
import { describe, expect, it, vi } from "vitest-compat";
import {
  cacheNameFor,
  createSwHandlers,
  type SwCache,
  type SwCacheStorage,
  type SwDeps,
} from "@/lib/client/pwa/sw-handlers";

const ORIGIN = "https://ava-crm.io";

class FakeCache implements SwCache {
  readonly entries = new Map<string, Response>();
  async match(request: Request | string, options?: { ignoreSearch?: boolean }): Promise<Response | undefined> {
    const url = typeof request === "string" ? request : request.url;
    const key = options?.ignoreSearch ? url.split("?")[0]! : url;
    for (const [k, v] of this.entries) {
      const candidate = options?.ignoreSearch ? k.split("?")[0]! : k;
      if (candidate === key) return v.clone();
    }
    return undefined;
  }
  async put(request: Request | string, response: Response): Promise<void> {
    const url = typeof request === "string" ? request : request.url;
    this.entries.set(url, response);
  }
}

class FakeCacheStorage implements SwCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name);
    if (!c) { c = new FakeCache(); this.caches.set(name, c); }
    return c;
  }
  async keys(): Promise<string[]> { return [...this.caches.keys()]; }
  async delete(name: string): Promise<boolean> { return this.caches.delete(name); }
}

function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init });
}

/** Response med readonly-fält överstyrda (redirected/type går inte att sätta via konstruktorn). */
function withProps(res: Response, props: Partial<Pick<Response, "redirected" | "type">>): Response {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(res, k, { value: v });
  return res;
}

interface Harness {
  storage: FakeCacheStorage;
  fetchMock: ReturnType<typeof vi.fn>;
  deps: SwDeps;
  handlers: ReturnType<typeof createSwHandlers>;
}

function harness(opts: {
  precache?: string[];
  version?: string;
  basePath?: string;
  respond?: (url: string) => Promise<Response>;
  networkTimeoutMs?: number;
} = {}): Harness {
  const storage = new FakeCacheStorage();
  const respond = opts.respond ?? (async (url: string) => html(`nät:${url}`));
  const fetchMock = vi.fn(async (input: Request | string) => respond(typeof input === "string" ? input : input.url));
  const deps: SwDeps = {
    caches: storage,
    fetch: fetchMock,
    skipWaiting: vi.fn(async () => {}),
    claimClients: vi.fn(async () => {}),
  };
  const handlers = createSwHandlers({
    version: opts.version ?? "v1",
    precache: opts.precache ?? ["/", "/matters/", "/matters/__shell__/", "/_next/static/chunks/a.js"],
    origin: ORIGIN,
    basePath: opts.basePath ?? "",
    networkTimeoutMs: opts.networkTimeoutMs ?? 50,
  }, deps);
  return { storage, fetchMock, deps, handlers };
}

const offline = async (): Promise<Response> => { throw new TypeError("Failed to fetch"); };
const navigate = (path: string): Request => new Request(`${ORIGIN}${path}`, { headers: { accept: "text/html" } });

/** Request med mode=navigate — konstruktorn får inte sätta det, så vi överstyr läsningen. */
function navRequest(path: string): Request {
  const req = navigate(path);
  Object.defineProperty(req, "mode", { value: "navigate" });
  return req;
}

describe("cacheNameFor", () => {
  it("prefixar versionen", () => {
    expect(cacheNameFor("abc")).toBe("ava-app-abc");
  });
});

describe("install", () => {
  it("förcachar varje sökväg under basen, utan att följa omdirigeringar", async () => {
    const h = harness({ basePath: "/ava", precache: ["/", "/matters/"] });
    await h.handlers.install();
    const cache = h.storage.caches.get("ava-app-v1")!;
    expect([...cache.entries.keys()].sort()).toEqual([`${ORIGIN}/ava/`, `${ORIGIN}/ava/matters/`]);
    const firstReq = h.fetchMock.mock.calls[0]![0] as Request;
    expect(firstReq.redirect).toBe("manual");
  });

  it("misslyckas om någon sökväg inte svarar 200 (ingen halv version)", async () => {
    const h = harness({ respond: async (url) => (url.endsWith("/matters/") ? new Response("", { status: 404 }) : html("ok")) });
    await expect(h.handlers.install()).rejects.toThrow(/matters/);
  });

  it("misslyckas på omdirigering (utgången session → IdP) i stället för att cacha inloggningssidan", async () => {
    const h = harness({ respond: async () => withProps(html("login"), { redirected: true }) });
    await expect(h.handlers.install()).rejects.toThrow();
  });

  it("misslyckas på opaqueredirect", async () => {
    const h = harness({ respond: async () => withProps(new Response(null, { status: 200 }), { type: "opaqueredirect" }) });
    await expect(h.handlers.install()).rejects.toThrow();
  });

  it("ett tillfälligt nätfel under förcachningen görs om (ett glapp ska inte kosta offline-stödet)", async () => {
    let calls = 0;
    const h = harness({
      precache: ["/"],
      respond: async () => { calls += 1; if (calls === 1) throw new TypeError("net::ERR_INVALID_HTTP_RESPONSE"); return html("ok"); },
    });
    await h.handlers.install();
    expect(calls).toBe(2);
    expect(h.storage.caches.get("ava-app-v1")!.entries.size).toBe(1);
  });

  it("ett bestående fel ger upp efter tre försök", async () => {
    const h = harness({ precache: ["/"], respond: async () => new Response("", { status: 503 }) });
    await expect(h.handlers.install()).rejects.toThrow(/503/);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
  });

  it("kallar inte skipWaiting själv (en ny version väntar på användarens klick)", async () => {
    const h = harness();
    await h.handlers.install();
    expect(h.deps.skipWaiting).not.toHaveBeenCalled();
  });
});

describe("activate", () => {
  it("raderar gamla ava-app-versioner men lämnar främmande cacher", async () => {
    const h = harness({ version: "v2" });
    await h.storage.open("ava-app-v1");
    await h.storage.open("ava-app-v2");
    await h.storage.open("annan-cache");
    await h.handlers.activate();
    expect((await h.storage.keys()).sort()).toEqual(["annan-cache", "ava-app-v2"]);
    expect(h.deps.claimClients).toHaveBeenCalledTimes(1);
  });
});

describe("handleMessage", () => {
  it("SKIP_WAITING från egen origin → skipWaiting", async () => {
    const h = harness();
    await h.handlers.handleMessage({ type: "SKIP_WAITING" }, ORIGIN);
    expect(h.deps.skipWaiting).toHaveBeenCalledTimes(1);
  });
  it("okända meddelanden ignoreras", async () => {
    const h = harness();
    await h.handlers.handleMessage({ type: "NÅGOT" }, ORIGIN);
    await h.handlers.handleMessage(null, ORIGIN);
    await h.handlers.handleMessage("SKIP_WAITING", ORIGIN);
    expect(h.deps.skipWaiting).not.toHaveBeenCalled();
  });
  it("meddelande från en annan origin (eller utan origin) ignoreras", async () => {
    const h = harness();
    await h.handlers.handleMessage({ type: "SKIP_WAITING" }, "https://evil.example");
    await h.handlers.handleMessage({ type: "SKIP_WAITING" }, "");
    await h.handlers.handleMessage({ type: "SKIP_WAITING" }, "null");
    expect(h.deps.skipWaiting).not.toHaveBeenCalled();
  });
});


describe("handleFetch — bypass", () => {
  it("returnerar null för /api (browsern tar förfrågan själv)", () => {
    const h = harness();
    expect(h.handlers.handleFetch(new Request(`${ORIGIN}/api/trpc/matter.list`))).toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
  it("returnerar null för POST", () => {
    const h = harness();
    expect(h.handlers.handleFetch(new Request(`${ORIGIN}/matters/`, { method: "POST", body: "x" }))).toBeNull();
  });
});

describe("handleFetch — cache-first (_next/static)", () => {
  it("serverar cachat utan nät", async () => {
    const h = harness({ respond: offline });
    const cache = await h.storage.open("ava-app-v1");
    await cache.put(`${ORIGIN}/_next/static/chunks/a.js`, new Response("js"));
    const res = await h.handlers.handleFetch(new Request(`${ORIGIN}/_next/static/chunks/a.js`))!;
    expect(await res.text()).toBe("js");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
  it("miss → hämtar från nätet och lägger i cachen", async () => {
    const h = harness({ respond: async () => new Response("ny chunk") });
    const res = await h.handlers.handleFetch(new Request(`${ORIGIN}/_next/static/chunks/lazy.js`))!;
    expect(await res.text()).toBe("ny chunk");
    const cached = await (await h.storage.open("ava-app-v1")).match(`${ORIGIN}/_next/static/chunks/lazy.js`);
    expect(await cached!.text()).toBe("ny chunk");
  });
  it("miss + fel från nätet (404) cachas inte", async () => {
    const h = harness({ respond: async () => new Response("", { status: 404 }) });
    const res = await h.handlers.handleFetch(new Request(`${ORIGIN}/_next/static/chunks/x.js`))!;
    expect(res.status).toBe(404);
    expect(await (await h.storage.open("ava-app-v1")).match(`${ORIGIN}/_next/static/chunks/x.js`)).toBeUndefined();
  });
  it("miss + offline → felet bubblar (inget att servera)", async () => {
    const h = harness({ respond: offline });
    await expect(h.handlers.handleFetch(new Request(`${ORIGIN}/_next/static/chunks/x.js`))!).rejects.toThrow(/Failed to fetch/);
  });
});

describe("handleFetch — network-first (sidor)", () => {
  it("online → färsk sida från nätet, och cachen uppdateras", async () => {
    const h = harness({ respond: async () => html("färsk") });
    const res = await h.handlers.handleFetch(navRequest("/matters/"))!;
    expect(await res.text()).toBe("färsk");
    const cached = await (await h.storage.open("ava-app-v1")).match(`${ORIGIN}/matters/`);
    expect(await cached!.text()).toBe("färsk");
  });

  it("offline → cachad sida", async () => {
    const h = harness({ respond: offline });
    await (await h.storage.open("ava-app-v1")).put(`${ORIGIN}/matters/`, html("cachad lista"));
    const res = await h.handlers.handleFetch(navRequest("/matters/"))!;
    expect(await res.text()).toBe("cachad lista");
  });

  it("offline → runtime-id får __shell__-sidan (samma som serverns rewrite)", async () => {
    const h = harness({ respond: offline });
    await (await h.storage.open("ava-app-v1")).put(`${ORIGIN}/matters/__shell__/`, html("skal"));
    const res = await h.handlers.handleFetch(navRequest("/matters/0190a1b2-aaaa-7000-8000-000000000009/"))!;
    expect(await res.text()).toBe("skal");
  });

  it("offline → okänd sida får roten", async () => {
    const h = harness({ respond: offline });
    await (await h.storage.open("ava-app-v1")).put(`${ORIGIN}/`, html("rot"));
    const res = await h.handlers.handleFetch(navRequest("/okand/"))!;
    expect(await res.text()).toBe("rot");
  });

  it("offline + ingenting cachat → nätfelet bubblar", async () => {
    const h = harness({ respond: offline });
    await expect(h.handlers.handleFetch(navRequest("/matters/"))!).rejects.toThrow(/Failed to fetch/);
  });

  it("RSC-payload offline matchas utan query (?_rsc=…)", async () => {
    const h = harness({ respond: offline });
    await (await h.storage.open("ava-app-v1")).put(`${ORIGIN}/matters/index.txt`, new Response("rsc"));
    const res = await h.handlers.handleFetch(new Request(`${ORIGIN}/matters/index.txt?_rsc=zz`))!;
    expect(await res.text()).toBe("rsc");
  });

  it("RSC-payload offline utan cache → ingen skal-fallback (bara navigeringar får den)", async () => {
    const h = harness({ respond: offline });
    await (await h.storage.open("ava-app-v1")).put(`${ORIGIN}/`, html("rot"));
    await expect(h.handlers.handleFetch(new Request(`${ORIGIN}/okand/index.txt`))!).rejects.toThrow();
  });

  it("omdirigering till inloggning skickas vidare men cachas inte", async () => {
    const h = harness({ respond: async () => withProps(new Response(null, { status: 200 }), { type: "opaqueredirect" }) });
    await (await h.storage.open("ava-app-v1")).put(`${ORIGIN}/matters/`, html("gammal"));
    const res = await h.handlers.handleFetch(navRequest("/matters/"))!;
    expect(res.type).toBe("opaqueredirect");
    const cached = await (await h.storage.open("ava-app-v1")).match(`${ORIGIN}/matters/`);
    expect(await cached!.text()).toBe("gammal");
  });

  it("5xx (proxyn nere) → cachad sida om den finns", async () => {
    const h = harness({ respond: async () => new Response("bad gateway", { status: 502 }) });
    await (await h.storage.open("ava-app-v1")).put(`${ORIGIN}/matters/`, html("cachad"));
    const res = await h.handlers.handleFetch(navRequest("/matters/"))!;
    expect(await res.text()).toBe("cachad");
  });

  it("5xx utan cache → serverns svar skickas vidare", async () => {
    const h = harness({ respond: async () => new Response("bad gateway", { status: 502 }) });
    const res = await h.handlers.handleFetch(navRequest("/matters/"))!;
    expect(res.status).toBe(502);
  });

  it("404 från nätet skickas vidare (ingen cache-fallback för en sida som inte finns)", async () => {
    const h = harness({ respond: async () => new Response("nope", { status: 404 }) });
    await (await h.storage.open("ava-app-v1")).put(`${ORIGIN}/`, html("rot"));
    const res = await h.handlers.handleFetch(navRequest("/okand/"))!;
    expect(res.status).toBe(404);
  });

  it("nät som hänger → cachad sida efter timeouten", async () => {
    const h = harness({ respond: () => new Promise<Response>(() => {}), networkTimeoutMs: 10 });
    await (await h.storage.open("ava-app-v1")).put(`${ORIGIN}/matters/`, html("cachad"));
    const res = await h.handlers.handleFetch(navRequest("/matters/"))!;
    expect(await res.text()).toBe("cachad");
  });

  it("långsamt nät utan cache → väntar ut nätet i stället för att ge upp", async () => {
    const h = harness({
      respond: () => new Promise<Response>((resolve) => setTimeout(() => resolve(html("sen")), 30)),
      networkTimeoutMs: 5,
    });
    const res = await h.handlers.handleFetch(navRequest("/matters/"))!;
    expect(await res.text()).toBe("sen");
  });

  it("utan konfigurerad timeout används standardvärdet (sidan kommer ändå)", async () => {
    const storage = new FakeCacheStorage();
    const handlers = createSwHandlers(
      { version: "v1", precache: [], origin: ORIGIN, basePath: "" },
      { caches: storage, fetch: async () => html("ok"), skipWaiting: async () => {}, claimClients: async () => {} },
    );
    const res = await handlers.handleFetch(navRequest("/"))!;
    expect(await res.text()).toBe("ok");
  });
});
