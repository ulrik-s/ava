/**
 * Lasttestets HTTP-mätning (#1366): anropsnamn, felkoder per anrop i en
 * batch, och den tidtagande `fetch`:en.
 */
import { describe, expect, it } from "vitest-compat";
import { OfflineError, operationsOf, outcomesOf, timedFetch } from "../../../../tooling/load/http-metrics";
import { LatencyRecorder } from "../../../../tooling/load/stats";

const trpcError = (code: string, httpStatus: number): unknown => ({ error: { json: { message: "x", code: -32603, data: { code, httpStatus } } } });

describe("operationsOf", () => {
  it("en batch blir en lista av anrop", () => {
    expect(operationsOf("http://h:1/api/trpc/sync.push,sync.pull?batch=1")).toEqual(["sync.push", "sync.pull"]);
    expect(operationsOf("http://h:1/api/trpc/sync.pull?batch=1&input=%7B%7D")).toEqual(["sync.pull"]);
  });

  it("utan tRPC-prefix: sökvägen", () => {
    expect(operationsOf("http://h:1/readyz")).toEqual(["/readyz"]);
  });
});

describe("outcomesOf", () => {
  it("ett lyckat svar per anrop", () => {
    expect(outcomesOf(["a", "b"], 200, JSON.stringify([{ result: {} }, { result: {} }]))).toEqual([{ op: "a", status: 200 }, { op: "b", status: 200 }]);
  });

  it("207: felet i en batch syns per anrop med sin egen status", () => {
    const body = JSON.stringify([{ result: {} }, trpcError("INTERNAL_SERVER_ERROR", 500)]);
    expect(outcomesOf(["a", "b"], 207, body)).toEqual([{ op: "a", status: 207 }, { op: "b", status: 500, error: "500:INTERNAL_SERVER_ERROR" }]);
  });

  it("ett ensamt felsvar (inte array)", () => {
    expect(outcomesOf(["a"], 404, JSON.stringify(trpcError("NOT_FOUND", 404)))).toEqual([{ op: "a", status: 404, error: "404:NOT_FOUND" }]);
  });

  it("fel utan kod → bara status", () => {
    expect(outcomesOf(["a"], 500, JSON.stringify({ error: { json: {} } }))).toEqual([{ op: "a", status: 500, error: "500" }]);
  });

  it("okänd kropp → svarets status för alla anrop", () => {
    expect(outcomesOf(["a", "b"], 502, "Bad Gateway")).toEqual([{ op: "a", status: 502, error: "502" }, { op: "b", status: 502, error: "502" }]);
    expect(outcomesOf(["a"], 200, "ok")).toEqual([{ op: "a", status: 200 }]);
    expect(outcomesOf(["a", "b"], 200, "[1]")).toEqual([{ op: "a", status: 200 }, { op: "b", status: 200 }]);
  });
});

describe("timedFetch", () => {
  it("sätter identiteten, tidtar och ger klienten samma svar", async () => {
    const recorder = new LatencyRecorder();
    const seen: { headers?: Headers } = {};
    let t = 0;
    const f = timedFetch({
      recorder, email: "a@b.se", isOnline: () => true, now: () => (t += 5),
      fetch: (_input, init) => { seen.headers = new Headers(init?.headers); return Promise.resolve(new Response("[{\"result\":{}}]", { status: 200, headers: { "x-test": "1" } })); },
    });
    const res = await f("http://h/api/trpc/sync.pull?batch=1", { headers: { a: "1" } });
    expect(await res.text()).toBe("[{\"result\":{}}]");
    expect(res.headers.get("x-test")).toBe("1");
    expect(seen.headers?.get("X-Auth-Request-Email")).toBe("a@b.se");
    expect(seen.headers?.get("a")).toBe("1");
    expect(recorder.summaries()["setup:sync.pull"]).toMatchObject({ count: 1, errors: 0, max: 5 });
  });

  it("offline → kastar som en webbläsare utan nät, utan att mäta", async () => {
    const recorder = new LatencyRecorder();
    const f = timedFetch({ recorder, email: "a@b.se", isOnline: () => false, fetch: () => Promise.reject(new Error("ska inte anropas")) });
    await expect(f("http://h/api/trpc/sync.pull")).rejects.toBeInstanceOf(OfflineError);
    expect(recorder.summaries()).toEqual({});
  });

  it("nätfel registreras som NETWORK och kastas vidare", async () => {
    const recorder = new LatencyRecorder();
    const f = timedFetch({ recorder, email: "a@b.se", isOnline: () => true, fetch: () => Promise.reject(new TypeError("down")) });
    await expect(f("http://h/api/trpc/sync.push,sync.pull")).rejects.toThrow("down");
    expect(recorder.errors()).toEqual({ "setup:NETWORK": 2 });
  });

  it("standard-fetch och performance.now används när inget injiceras", () => {
    expect(typeof timedFetch({ recorder: new LatencyRecorder(), email: "a@b.se", isOnline: () => true })).toBe("function");
  });
});
