/**
 * Test för server-runtime D (#118) — PeerLoop.
 *
 * Driver loopen deterministiskt via `tickOnce()` med injicerade seams
 * (`runCycle`/`syncOnce`), så ingen riktig git behövs här. Verifierar
 * cykel-läge, sync-läge, felresiliens och start/stop-idempotens.
 */

import { describe, it, expect } from "vitest-compat";

import { PeerLoop, type PeerLoopDeps } from "@/lib/server/local-first/peer-loop";
import type { PeerCycleResult } from "@/lib/server/local-first/server-peer";
import type { Principal } from "@/lib/server/auth/principal";

const PRINCIPAL: Principal = {
  id: "server-runtime",
  email: "sr@ava.local",
  name: "SR",
  role: "ADMIN",
  organizationId: "org-1",
};

function baseDeps(over: Partial<PeerLoopDeps> = {}): PeerLoopDeps {
  return {
    dir: "/wc",
    cycleOpts: { principal: PRINCIPAL },
    intervalMs: 60_000,
    log: () => {},
    ...over,
  };
}

describe("PeerLoop (#118)", () => {
  it("sync-läge: kör syncOnce när inget job är satt", async () => {
    const calls: string[] = [];
    const loop = new PeerLoop(baseDeps({
      syncOnce: async (dir) => { calls.push(dir); },
      runCycle: async () => { throw new Error("ska inte anropas i sync-läge"); },
    }));
    const tick = await loop.tickOnce();
    expect(tick.mode).toBe("sync");
    expect(calls).toEqual(["/wc"]);
  });

  it("cykel-läge: kör runCycle med jobbets act + message", async () => {
    const seen: { message?: string } = {};
    const result: PeerCycleResult = { pushed: true, attempts: 1 };
    const loop = new PeerLoop(baseDeps({
      job: { act: async () => {}, message: "feat: x" },
      runCycle: async (_dir, _act, message) => { seen.message = message; return result; },
      syncOnce: async () => { throw new Error("ska inte anropas i cykel-läge"); },
    }));
    const tick = await loop.tickOnce();
    expect(tick).toEqual({ mode: "cycle", result });
    expect(seen.message).toBe("feat: x");
  });

  it("felresiliens: en kastande tick blir mode 'error', inte ett rejected promise", async () => {
    const boom = new Error("nätverk nere");
    const loop = new PeerLoop(baseDeps({
      syncOnce: async () => { throw boom; },
    }));
    const tick = await loop.tickOnce();
    expect(tick).toEqual({ mode: "error", error: boom });
  });

  it("lock: omsluter hela ticket (acquire → arbete → release)", async () => {
    const events: string[] = [];
    const lock = async <T>(fn: () => Promise<T>): Promise<T> => {
      events.push("acquire");
      try { return await fn(); } finally { events.push("release"); }
    };
    const loop = new PeerLoop(baseDeps({
      syncOnce: async () => { events.push("sync"); },
      lock,
    }));
    await loop.tickOnce();
    expect(events).toEqual(["acquire", "sync", "release"]);
  });

  it("start() är idempotent och stop() rensar timern", async () => {
    let ticks = 0;
    const loop = new PeerLoop(baseDeps({
      intervalMs: 5,
      syncOnce: async () => { ticks += 1; },
    }));
    loop.start();
    loop.start(); // andra anropet är no-op (ingen andra timer)
    await new Promise((r) => setTimeout(r, 30));
    loop.stop();
    const after = ticks;
    expect(after).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 20));
    // Inga fler ticks efter stop().
    expect(ticks).toBe(after);
  });
});
