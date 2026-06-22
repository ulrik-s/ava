/**
 * Lease-heartbeat (ADR 0033 §2/§4) — håller helperns lease levande medan
 * dokumentet är öppet för redigering, och släpper den när sessionen tar slut.
 *
 * Förnyar leasen var ~30 s tills `timeoutMs` löpt ut (samma livslängd som
 * watch-loopen), släpper sedan i en `finally` (även vid förlorad lease eller
 * fel) så ett dött lås aldrig blir kvar längre än serverns expire-tröskel.
 * Tappas leasen (övertagen av annan) slutar vi förnya — användarens fortsatta
 * sparningar 409:ar då och hamnar i keep-both (steg 2).
 *
 * IO/klocka injiceras (`LeaseHeartbeatDeps`) → deterministiska tester.
 */

import { log } from "./log.ts";

const RENEW_INTERVAL_MS = 30_000;

export interface LeaseHeartbeatDeps {
  /** Förnya leasen; `false` = vi håller den inte längre (övertagen/utgången). */
  renew: () => Promise<boolean>;
  /** Släpp leasen (anropas en gång när sessionen slutar). */
  release: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const defaultLeaseTimers = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  now: (): number => Date.now(),
};

/** Starta heartbeaten (fire-and-forget); den släpper leasen vid timeout/förlust. */
export function startLeaseHeartbeat(deps: LeaseHeartbeatDeps, timeoutMs: number): void {
  void runLeaseHeartbeat(deps, timeoutMs);
}

export async function runLeaseHeartbeat(deps: LeaseHeartbeatDeps, timeoutMs: number): Promise<void> {
  const deadline = deps.now() + timeoutMs;
  try {
    while (deps.now() < deadline) {
      await deps.sleep(RENEW_INTERVAL_MS);
      if (deps.now() >= deadline) break;
      let held: boolean;
      try {
        held = await deps.renew();
      } catch (err) {
        // Nätfel → försök igen nästa varv (leasen löper ut server-side om vi tystnar).
        log(`lease-renew fel (försöker igen): ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (!held) {
        log("lease förlorad (övertagen?) — slutar förnya");
        return;
      }
    }
  } finally {
    await deps.release().catch(() => { /* best-effort; leasen löper ut ändå */ });
  }
}
