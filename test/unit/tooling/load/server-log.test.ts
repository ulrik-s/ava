/**
 * Serverns egen tid per procedur ur den strukturerade loggen (#1366).
 */
import { describe, expect, it } from "vitest-compat";
import { parseServerLog, serverTimings, summarizeServerLog } from "../../../../tooling/load/server-log";

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

  it("serverTimings utan containrar → tomt", async () => {
    expect(await serverTimings([], "2026-10-01T00:00:00Z")).toEqual({});
  });

  it("serverTimings med en container som inte finns → tomt (docker-felet sväljs)", async () => {
    expect(await serverTimings(["finns-inte-1366"], "2026-10-01T00:00:00Z")).toEqual({});
  });
});
