/**
 * helper-ui-logiken (ADR 0029/0030) — tray-presentation + status-polling.
 * Allt IO injicerat → testbart utan Electron/display. (Motorn körs numera
 * in-process via `startEngine`; dess integration testas i
 * `engine.integration.test.ts`, inte här.)
 */

import { describe, expect, test } from "bun:test";

import { pollHelper } from "../src/status-poller.ts";
import { trayView, updateStatusLine } from "../src/tray-status.ts";

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

describe("updateStatusLine", () => {
  const now = new Date("2026-11-15T20:00:00");
  const at = new Date("2026-11-15T18:05:00");
  test("inte kontrollerad än", () => {
    expect(updateStatusLine("v1.0.0", { checking: false, notice: null, last: null }, now)).toBe("v1.0.0 — inte kontrollerad än");
  });
  test("pågår", () => {
    expect(updateStatusLine("v1.0.0", { checking: true, notice: null, last: null }, now)).toBe("v1.0.0 — söker efter uppdatering…");
  });
  test("utfall med klockslag samma dag", () => {
    expect(updateStatusLine("v1.0.0", { checking: false, notice: null, last: { at, result: "up-to-date" } }, now))
      .toBe("v1.0.0 — senaste versionen (kl 18:05)");
  });
  test("annan dag → datum", () => {
    const line = updateStatusLine("v1.0.0", { checking: false, notice: null, last: { at, result: "error" } }, new Date("2026-11-17T09:00:00"));
    expect(line).toMatch(/^v1\.0\.0 — kunde inte söka \(15 nov\.? 18:05\)$/);
  });
});
