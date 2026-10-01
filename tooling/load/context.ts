/**
 * Det scenarierna delar (#1366): konfigurationen, mätningen, de virtuella
 * användarna och serverns databaser — plus en räknare för handlingarnas utfall.
 */

import type { LoadConfig, Scenario } from "./config";
import type { Rng } from "./rng";
import type { ServerDb } from "./server-db";
import type { LatencyRecorder } from "./stats";
import type { VirtualUser } from "./virtual-user";

export interface LoadContext {
  config: LoadConfig;
  recorder: LatencyRecorder;
  users: readonly VirtualUser[];
  /** Byråns databas (index → läsåtkomst). */
  dbs: ReadonlyMap<number, ServerDb>;
  rng: Rng;
  /** Ärendet varje användare arbetar i (användarens index → ärende-id). */
  matters: Map<number, string>;
  /** Dokument med innehåll per byrå (byråns index → dokument-id). */
  documents: Map<number, string[]>;
}

/** Ett scenarios utfall: mätvärden för rapporten och brotten mot kraven. */
export interface ScenarioResult {
  scenario: Scenario;
  durationMs: number;
  details: Record<string, unknown>;
  violations: string[];
}

/** Räknar handlingarnas utfall per namn, och sparar några exempel på fel. */
export class ActionTally {
  private readonly ok = new Map<string, number>();
  private readonly failed = new Map<string, number>();
  readonly examples: string[] = [];

  succeed(name: string): void {
    this.ok.set(name, (this.ok.get(name) ?? 0) + 1);
  }

  fail(name: string, err: unknown): void {
    this.failed.set(name, (this.failed.get(name) ?? 0) + 1);
    if (this.examples.length < 10) this.examples.push(`${name}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }

  /** Kör `fn` och räkna utfallet; ett fel sväljs (det är ett mätvärde, inte ett avbrott). */
  async run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const value = await fn();
      this.succeed(name);
      return value;
    } catch (err) {
      this.fail(name, err);
      return undefined;
    }
  }

  get failures(): number {
    return [...this.failed.values()].reduce((sum, n) => sum + n, 0);
  }

  toJSON(): { ok: Record<string, number>; failed: Record<string, number>; examples: string[] } {
    const sorted = (m: Map<string, number>): Record<string, number> => Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
    return { ok: sorted(this.ok), failed: sorted(this.failed), examples: this.examples };
  }
}

/** Hur många avvisade ändringar varje användare har just nu (för `rejectionsSince`). */
export function rejectedCounts(users: ReadonlyArray<Pick<VirtualUser, "rejected">>): number[] {
  return users.map((vu) => vu.rejected.list().length);
}

/** Avvisningar sedan `before` (från `rejectedCounts`): antal och några exempel med serverns skäl. */
export function rejectionsSince(users: ReadonlyArray<Pick<VirtualUser, "rejected">>, before: readonly number[]): { count: number; examples: string[] } {
  const fresh = users.flatMap((vu, i) => vu.rejected.list().slice(before[i] ?? 0));
  return { count: fresh.length, examples: fresh.slice(0, 10).map((r) => `${r.label}: ${r.reason}`) };
}

/** Användarna i en byrå. */
export function usersInOrg<U extends Pick<VirtualUser, "user">>(ctx: { users: readonly U[] }, orgIndex: number): U[] {
  return ctx.users.filter((u) => u.user.org.index === orgIndex);
}

/** Byråns databas (kastar om den saknas — ett fel i uppsättningen, inte i servern). */
export function dbFor(ctx: Pick<LoadContext, "dbs">, orgIndex: number): ServerDb {
  const db = ctx.dbs.get(orgIndex);
  if (!db) throw new Error(`ingen databas för byrå ${orgIndex}`);
  return db;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
