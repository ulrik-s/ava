/**
 * Lasttestets mätvärden (#1366): percentiler, sammanfattningar och räknare.
 */
import { describe, expect, it } from "vitest-compat";
import { EventLoopLag, LatencyRecorder, percentile, summarize } from "../../../../tooling/load/stats";

describe("percentile (nearest rank)", () => {
  const xs = Array.from({ length: 100 }, (_, i) => i + 1);

  it("p50/p95/p99 på 1..100", () => {
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 99)).toBe(99);
    expect(percentile(xs, 100)).toBe(100);
  });

  it("p0 ger minsta värdet, gränserna klämms", () => {
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, -5)).toBe(1);
    expect(percentile(xs, 150)).toBe(100);
  });

  it("tom lista → 0, ett värde → det värdet", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe("summarize", () => {
  it("sorterar själv och avrundar till en decimal", () => {
    expect(summarize([3, 1, 2.26], 1)).toEqual({ count: 3, errors: 1, mean: 2.1, p50: 2.3, p95: 3, p99: 3, max: 3 });
  });

  it("tom serie", () => {
    expect(summarize([])).toEqual({ count: 0, errors: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe("LatencyRecorder", () => {
  it("håller isär faserna, räknar fel per anrop och kod, och 5xx", () => {
    const r = new LatencyRecorder();
    r.record({ op: "sync.pull", ms: 10, status: 200 });
    r.phase = "work";
    r.record({ op: "sync.pull", ms: 20, status: 200 });
    r.record({ op: "sync.push", ms: 30, status: 500, error: "500:INTERNAL_SERVER_ERROR" });
    r.record({ op: "sync.push", ms: 5, status: 0, error: "NETWORK" });
    r.record({ op: "sync.push", ms: 5, status: 404, error: "404:NOT_FOUND" });
    expect(Object.keys(r.summaries())).toEqual(["setup:sync.pull", "work:sync.pull", "work:sync.push"]);
    expect(r.summaries()["work:sync.push"]).toMatchObject({ count: 3, errors: 3, max: 30 });
    expect(r.errors()).toEqual({ "work:404:NOT_FOUND": 1, "work:500:INTERNAL_SERVER_ERROR": 1, "work:NETWORK": 1 });
    expect(r.count5xx).toBe(1);
  });
});

describe("EventLoopLag", () => {
  it("mäter hur sent varje tick kom, per fas", async () => {
    let t = 0;
    let phase = "a";
    const lag = new EventLoopLag();
    lag.start(() => phase, 5, () => (t += 7));
    await new Promise((r) => setTimeout(r, 30));
    phase = "b";
    await new Promise((r) => setTimeout(r, 30));
    const s = lag.stop();
    expect(Object.keys(s).sort()).toEqual(["a", "b"]);
    expect(s.a?.count).toBeGreaterThan(0);
    expect(s.a?.max).toBeGreaterThanOrEqual(0);
    expect(lag.stop().a?.count).toBe(s.a?.count);
  });
});
