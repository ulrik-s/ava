/**
 * Serverns egen tid per procedur ur den strukturerade loggen (#1366).
 */
import { describe, expect, it } from "vitest-compat";
import { type ContainerLogReader, parseServerLog, serverTimings, summarizeServerLog } from "../../../../tooling/load/server-log";

const SINCE = "2026-10-01T00:00:00Z";

const line = (path: string, durationMs: number, outcome = "ok", event = "trpc.mutation"): string =>
  JSON.stringify({ ts: "2026-10-01T00:00:00Z", level: outcome === "ok" ? "debug" : "error", event, requestId: "R", path, durationMs, outcome });

describe("parseServerLog", () => {
  it("en post per tRPC-anrop, fel räknade; annat hoppas över", () => {
    const text = [
      "[server-first] lyssnar på 0.0.0.0:3001",
      line("sync.push", 4),
      line("sync.push", 9, "error"),
      line("sync.pull", 2, "ok", "trpc.query"),
      "{inte json",
      JSON.stringify({ event: "jobqueue.error", message: "x" }),
      "",
    ].join("\n");
    const parsed = parseServerLog(text);
    expect([...parsed.keys()].sort()).toEqual(["sync.pull", "sync.push"]);
    expect(parsed.get("sync.push")).toEqual({ ms: [4, 9], errors: 1 });
  });

  it("summarizeServerLog sorterar och sammanfattar", () => {
    const s = summarizeServerLog(parseServerLog([line("b", 1), line("a", 2), line("a", 4, "error")].join("\n")));
    expect(Object.keys(s)).toEqual(["a", "b"]);
    expect(s.a).toMatchObject({ count: 2, errors: 1, max: 4 });
  });

  it("serverTimings utan containrar → tomt, och läsaren anropas inte", async () => {
    const calls: string[] = [];
    const readLog: ContainerLogReader = (c) => { calls.push(c); return Promise.resolve(""); };
    expect(await serverTimings([], SINCE, readLog)).toEqual({});
    expect(calls).toEqual([]);
  });

  it("serverTimings sammanfattar loggarna från alla containrar, med rätt container och since", async () => {
    const calls: [string, string][] = [];
    const logs: Record<string, string> = {
      "server-1": [line("sync.push", 4), line("sync.push", 9, "error")].join("\n"),
      "server-2": line("sync.pull", 2, "ok", "trpc.query"),
    };
    const readLog: ContainerLogReader = (c, since) => { calls.push([c, since]); return Promise.resolve(logs[c] ?? ""); };
    const s = await serverTimings(["server-1", "server-2"], SINCE, readLog);
    expect(calls).toEqual([["server-1", SINCE], ["server-2", SINCE]]);
    expect(Object.keys(s)).toEqual(["sync.pull", "sync.push"]);
    expect(s["sync.push"]).toMatchObject({ count: 2, errors: 1 });
    expect(s["sync.pull"]).toMatchObject({ count: 1, errors: 0 });
  });

  it("serverTimings räknar en container som inte går att läsa som tom; de andra räknas ändå", async () => {
    const readLog: ContainerLogReader = (c) =>
      c === "finns-inte" ? Promise.reject(new Error("No such container")) : Promise.resolve(line("sync.push", 3));
    const s = await serverTimings(["finns-inte", "server-1"], SINCE, readLog);
    expect(Object.keys(s)).toEqual(["sync.push"]);
    expect(s["sync.push"]).toMatchObject({ count: 1, errors: 0 });
  });
});
