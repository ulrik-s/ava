/**
 * Tester för http-target (#846): proxyn ska dispatcha query vs mutation rätt
 * (ur appRouter._def.procedures) och mintToken ska retrya transienta fel men
 * INTE icke-transienta (fel creds → kasta direkt).
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";

import { createHttpCaller, mintToken } from "../../tooling/demo-generator/http-target";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const calls: Array<[string, string, Any]> = [];

vi.mock("@trpc/client", () => ({
  httpBatchLink: (o: Any) => o,
  createTRPCClient: () =>
    new Proxy({}, {
      get: (_t, k1: string) =>
        new Proxy({}, {
          get: (_t2, k2: string) => ({
            query: (input: Any) => { calls.push(["query", `${k1}.${k2}`, input]); return Promise.resolve({ ok: "query" }); },
            mutate: (input: Any) => { calls.push(["mutate", `${k1}.${k2}`, input]); return Promise.resolve({ ok: "mutate" }); },
          }),
        }),
    }),
}));

beforeEach(() => { calls.length = 0; });

describe("createHttpCaller — dispatch query vs mutation", () => {
  it("matter.create → mutate; billingRun.list → query (ur routerns def)", async () => {
    const caller = createHttpCaller({ trpcUrl: "http://x/api/trpc", token: "t" }) as Any;
    await caller.matter.create({ id: "m1" });
    await caller.billingRun.list({});
    await caller.invoice.getById({ id: "i1" });
    expect(calls).toContainEqual(["mutate", "matter.create", { id: "m1" }]);
    expect(calls).toContainEqual(["query", "billingRun.list", {}]);
    expect(calls).toContainEqual(["query", "invoice.getById", { id: "i1" }]);
  });
});

describe("mintToken", () => {
  it("200 med access_token → returnerar token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const tok = await mintToken({ kcBaseUrl: "http://kc", realm: "ava", clientId: "ava", clientSecret: "s", username: "u", password: "p" });
    expect(tok).toBe("abc");
    vi.unstubAllGlobals();
  });

  it("401 (fel creds) → kastar direkt, ingen retry", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(mintToken({ kcBaseUrl: "http://kc", realm: "ava", clientId: "ava", clientSecret: "s", username: "u", password: "p" }, 5))
      .rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("nät-fel → retry tills det lyckas", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      if (n < 3) throw new Error("socket closed");
      return new Response(JSON.stringify({ access_token: "late" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const tok = await mintToken({ kcBaseUrl: "http://kc", realm: "ava", clientId: "ava", clientSecret: "s", username: "u", password: "p" }, 5);
    expect(tok).toBe("late");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });
});
