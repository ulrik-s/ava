/**
 * Delade test-fixturer (DRY) — request-byggare + en deterministisk
 * fejk-klocka för tidsberoende loop-tester.
 */

import { HELPER_BASE } from "@/lib/shared/helper/protocol";

export const BASE = HELPER_BASE;

/** Bygg en Request mot helpern. */
export function mkRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, init);
}

/** Bygg en JSON-POST (default-metod POST). */
export function jsonRequest(path: string, body: unknown, method = "POST"): Request {
  return mkRequest(path, { method, body: JSON.stringify(body) });
}

/**
 * Deterministisk klocka: `now()` returnerar ett fast värde som bara rör
 * sig när testet anropar `advance(ms)`. Används för watch-/loop-tester.
 */
export interface FakeClock {
  now: () => number;
  advance: (ms: number) => void;
}

export function fakeClock(start = 0): FakeClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * Await ett promise som FÖRVÄNTAS rejecta och returnera felet. Renare än
 * `expect(p).rejects` (vars matcher-kedja typas som icke-thenable i
 * bun-types → krockar med await-thenable-regeln) och DRY över suiten.
 */
export async function expectRejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("förväntade att promiset skulle rejecta, men det resolvade");
}
