/**
 * Delade test-fixturer (DRY) — request-byggare + en deterministisk
 * fejk-klocka för tidsberoende loop-tester.
 */

import { HELPER_BASE } from "@/lib/shared/helper/protocol";

export const BASE = HELPER_BASE;

/** Webbappens origin i testerna — localhost är alltid godkänd (#1448). */
export const APP_ORIGIN = "http://localhost:3000";

/** Bygg en Request mot helpern, som från webbappen (Origin satt om inte testet anger en). */
export function mkRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", APP_ORIGIN);
  return new Request(`${BASE}${path}`, { ...init, headers });
}

/** Bygg en JSON-POST (default-metod POST) med `Content-Type: application/json`. */
export function jsonRequest(path: string, body: unknown, method = "POST"): Request {
  return mkRequest(path, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
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
