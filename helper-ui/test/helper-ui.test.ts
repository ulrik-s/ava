/**
 * helper-ui-logiken (ADR 0029) — tray-presentation, status-polling och
 * engine-supervisor. Allt IO injicerat → testbart utan Electron/display/process.
 */

import { describe, expect, test } from "bun:test";

import { EngineSupervisor, type EngineDeps, type SpawnedProcess } from "../src/engine.ts";
import { pollHelper } from "../src/status-poller.ts";
import { trayView } from "../src/tray-status.ts";

function status(pending: number, conflict: number) {
  return { pending, conflict, total: pending + conflict, entries: [] };
}

describe("trayView", () => {
  test("ej igång → absent", () => {
    expect(trayView(false, null)).toMatchObject({ state: "absent", title: "" });
  });
  test("tom kö → synced", () => {
    expect(trayView(true, status(0, 0))).toMatchObject({ state: "synced", title: "" });
    expect(trayView(true, null)).toMatchObject({ state: "synced" });
  });
  test("väntande → pending med antal", () => {
    expect(trayView(true, status(3, 0))).toMatchObject({ state: "pending", title: "3" });
  });
  test("konflikt prioriteras över väntande", () => {
    const v = trayView(true, status(1, 2));
    expect(v.state).toBe("conflict");
    expect(v.title).toBe("!2");
  });
});

describe("pollHelper", () => {
  function res(body: string, status = 200, json?: unknown): Response {
    return json !== undefined
      ? new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } })
      : new Response(body, { status });
  }

  test("ping ok + status → present med version + status", async () => {
    const fetchFn = async (url: string) =>
      url.endsWith("/ping") ? res("ava-helper v1.2.3\n") : res("", 200, status(2, 0));
    const snap = await pollHelper(fetchFn, "http://h");
    expect(snap).toMatchObject({ present: true, version: "v1.2.3" });
    expect(snap.status).toMatchObject({ pending: 2 });
  });

  test("ping fel → absent (ingen status-fråga behövs)", async () => {
    const snap = await pollHelper(async () => res("down", 500), "http://h");
    expect(snap).toEqual({ present: false, version: null, status: null });
  });

  test("ping kastar → absent", async () => {
    const snap = await pollHelper(async () => { throw new Error("ECONNREFUSED"); }, "http://h");
    expect(snap.present).toBe(false);
  });

  test("ping ok men status trasig → present men status null", async () => {
    const fetchFn = async (url: string) => (url.endsWith("/ping") ? res("ava-helper v1\n") : res("garbage"));
    const snap = await pollHelper(fetchFn, "http://h");
    expect(snap).toMatchObject({ present: true, status: null });
  });
});

describe("EngineSupervisor", () => {
  interface FakeProc extends SpawnedProcess { fireExit: () => void; killed: boolean; }
  function fakeDeps(): { deps: EngineDeps; spawns: FakeProc[]; runTimers: () => void; t: { now: number } } {
    const spawns: FakeProc[] = [];
    const timers: Array<() => void> = [];
    const t = { now: 0 };
    const deps: EngineDeps = {
      spawn: () => {
        let exitCb = (): void => {};
        const p: FakeProc = { killed: false, kill() { this.killed = true; }, onExit(cb) { exitCb = cb; }, fireExit() { exitCb(); } };
        spawns.push(p);
        return p;
      },
      now: () => t.now,
      setTimer: (fn) => { timers.push(fn); return () => {}; },
    };
    return { deps, spawns, runTimers: () => { const fns = timers.splice(0); fns.forEach((f) => f()); }, t };
  }

  test("start spawnar motorn", () => {
    const h = fakeDeps();
    const sup = new EngineSupervisor("/bin/engine", [], h.deps);
    sup.start();
    expect(h.spawns).toHaveLength(1);
    expect(sup.isRunning()).toBe(true);
  });

  test("krasch → startar om (efter timern)", () => {
    const h = fakeDeps();
    const sup = new EngineSupervisor("/bin/engine", [], h.deps);
    sup.start();
    h.spawns[0]!.fireExit();
    expect(sup.isRunning()).toBe(false); // dog
    h.runTimers(); // omstart-timern
    expect(h.spawns).toHaveLength(2);
    expect(sup.isRunning()).toBe(true);
  });

  test("stop dödar processen och hindrar omstart", () => {
    const h = fakeDeps();
    const sup = new EngineSupervisor("/bin/engine", [], h.deps);
    sup.start();
    sup.stop();
    expect(h.spawns[0]!.killed).toBe(true);
    h.spawns[0]!.fireExit();
    h.runTimers();
    expect(h.spawns).toHaveLength(1); // ingen omstart efter stop
  });

  test("för många kraschar i fönstret → ger upp", () => {
    const h = fakeDeps();
    const sup = new EngineSupervisor("/bin/engine", [], h.deps);
    sup.start();
    for (let i = 0; i < 6; i++) {
      h.spawns[h.spawns.length - 1]!.fireExit();
      h.runTimers();
    }
    expect(sup.hasGivenUp()).toBe(true);
    expect(sup.isRunning()).toBe(false);
  });

  test("dubbel start är idempotent", () => {
    const h = fakeDeps();
    const sup = new EngineSupervisor("/bin/engine", [], h.deps);
    sup.start();
    sup.start();
    expect(h.spawns).toHaveLength(1);
  });
});
