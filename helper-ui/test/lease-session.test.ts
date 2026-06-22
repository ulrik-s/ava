/**
 * Lease-heartbeat (ADR 0033 §2/§4) — förnyar tills timeout, släpper alltid.
 * Klocka/sleep injiceras (sleep avancerar nu) → deterministiskt utan riktig tid.
 */

import { describe, expect, test } from "bun:test";
import { runLeaseHeartbeat, type LeaseHeartbeatDeps } from "../src/engine/lease-session.ts";

/** Fake där `sleep(ms)` flyttar klockan framåt `ms` → loopen blir deterministisk. */
function fakeTimers(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

describe("runLeaseHeartbeat", () => {
  test("förnyar var 30 s tills timeout, släpper sedan en gång", async () => {
    const timers = fakeTimers();
    let renews = 0;
    let released = 0;
    const deps: LeaseHeartbeatDeps = {
      ...timers,
      renew: async () => { renews++; return true; },
      release: async () => { released++; },
    };
    await runLeaseHeartbeat(deps, 90_000); // förnyar vid 30s, 60s; vid 90s → deadline
    expect(renews).toBe(2);
    expect(released).toBe(1);
  });

  test("tappar leasen (renew → false) → slutar förnya men släpper ändå", async () => {
    const timers = fakeTimers();
    let released = 0;
    await runLeaseHeartbeat(
      { ...timers, renew: async () => false, release: async () => { released++; } },
      300_000,
    );
    expect(released).toBe(1);
  });

  test("renew kastar (nätfel) → fortsätter nästa varv (släpper inte i förtid)", async () => {
    const timers = fakeTimers();
    let calls = 0;
    await runLeaseHeartbeat(
      {
        ...timers,
        renew: async () => { calls++; if (calls === 1) throw new Error("ECONNREFUSED"); return calls < 3; },
        release: async () => { /* noop */ },
      },
      200_000,
    );
    expect(calls).toBe(3); // kastade vid #1, fortsatte, #3 gav false → stopp
  });

  test("release-fel fäller inte heartbeaten", async () => {
    const timers = fakeTimers();
    await expect(
      runLeaseHeartbeat(
        { ...timers, renew: async () => true, release: async () => { throw new Error("net"); } },
        60_000,
      ),
    ).resolves.toBeUndefined();
  });
});
