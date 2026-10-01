/**
 * Lasttestets rapport och gränser (#1366), plus de små hjälparna scenarierna
 * delar (räknaren, avvisningarna, slumpen).
 */
import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest-compat";
import { RejectedChanges } from "@/lib/client/backend/rejected-changes";
import { parseLoadConfig } from "../../../../tooling/load/config";
import { ActionTally, dbFor, rejectedCounts, rejectionsSince, usersInOrg } from "../../../../tooling/load/context";
import { evaluateThresholds, formatOperations, formatSummary, type LoadReport } from "../../../../tooling/load/report";
import { rng, weighted } from "../../../../tooling/load/rng";
import { openJobs } from "../../../../tooling/load/scenarios/documents";
import { failureCode, rowIdOf } from "../../../../tooling/load/scenarios/idempotency";
import { summarize } from "../../../../tooling/load/stats";

const thresholds = parseLoadConfig({ LOAD_MAX_SERVER_MEM_MIB: "1000" }).thresholds;

function report(over: Partial<LoadReport> = {}): LoadReport {
  return {
    startedAt: "2026-10-01T00:00:00Z", finishedAt: "2026-10-01T00:05:00Z",
    config: { users: 20, orgs: 2, scenarios: ["work"], durationS: 60, offline: [50, 200], seed: 1 },
    thresholds,
    operations: { "work:sync.pull": summarize([10, 20, 30]), "storm:sync.pull": summarize([5000]) },
    serverOperations: { "sync.pull": summarize([3, 4]) },
    errors: {}, count5xx: 0,
    scenarios: [{ scenario: "storm", durationMs: 1500, details: { drainMs: 1200, queuedTotal: 10 }, violations: [] }],
    convergence: { clients: 20, views: ["timeEntries"], mismatches: [], freshClientMismatches: [] },
    postgres: {
      maxConnections: 100, peakConnections: 30, peakActive: 8, peakIdleInTransaction: 0, peakLockWaiters: 1,
      maxSampledLockWaitMs: 20, lockWaitsOverTimeout: 0, maxLoggedLockWaitMs: 0, deadlocks: 0, deadlocksLogged: 0, samples: 100,
    },
    containers: { "ava-load-server-1-1": { samples: 3, cpuAvgPct: 20, cpuMaxPct: 80, memMaxMiB: 120 } },
    clientEventLoopLag: { work: summarize([1, 2]) },
    violations: [],
    ...over,
  };
}

describe("evaluateThresholds", () => {
  it("en körning inom gränserna → inga brott (stormens svarstider räknas inte mot p95)", () => {
    expect(evaluateThresholds(report())).toEqual([]);
  });

  it("varje gräns ger sitt brott", () => {
    const pg = report().postgres;
    const v = evaluateThresholds(report({
      operations: { "work:sync.pull": summarize([900]), "work:client.reconcile": summarize([9000]), "konstig": summarize([1]) },
      count5xx: 3,
      convergence: { clients: 1, views: [], mismatches: ["a@b timeEntries: 1 rader skiljer sig"], freshClientMismatches: ["ny klient byrå 1 matters: x"] },
      postgres: pg && { ...pg, peakConnections: 100, maxLoggedLockWaitMs: 2500, lockWaitsOverTimeout: 2, deadlocks: 1 },
      containers: { "ava-load-server-1-1": { samples: 1, cpuAvgPct: 1, cpuMaxPct: 1, memMaxMiB: 1500 }, "ava-load-postgres-1": { samples: 1, cpuAvgPct: 1, cpuMaxPct: 1, memMaxMiB: 9000 } },
    }));
    expect(v).toEqual([
      "p95 för sync.pull i vanligt arbete är 900 ms (gräns 500 ms)",
      "3 svar med HTTP 5xx (gräns 0)",
      "konvergens: a@b timeEntries: 1 rader skiljer sig",
      "konvergens: ny klient byrå 1 matters: x",
      "Postgres: 100 anslutningar nådde max_connections (100)",
      "Postgres: låsväntan 2500 ms (gräns 1000 ms; 2 väntor > 1 s i loggen)",
      "Postgres: 1 deadlocks (gräns 0)",
      "ava-load-server-1-1: 1500 MiB minne (gräns 1000 MiB)",
    ]);
  });

  it("utan Postgres-mätning, konvergens eller minnesgräns → inget att pröva där", () => {
    const r = report({ postgres: null, convergence: null, thresholds: { ...thresholds, maxServerMemMiB: null } });
    expect(evaluateThresholds(r)).toEqual([]);
  });
});

describe("formatSummary", () => {
  it("visar tabellen, scenarierna, Postgres och resultatet", () => {
    const text = formatSummary(report());
    expect(text).toContain("20 användare i 2 byråer");
    expect(text).toContain("work:sync.pull");
    expect(text).toContain("storm (1.5 s): drainMs=1200 queuedTotal=10");
    expect(text).toContain("Postgres: max 30/100 anslutningar");
    expect(text).toContain("RESULTAT: alla krav uppfyllda");
    expect(text).toContain("work 2/2");
    expect(text).toMatch(/procedur\s+antal/);
  });

  it("brott och saknade mätningar", () => {
    const text = formatSummary(report({ violations: ["x"], postgres: null, convergence: null, containers: {}, errors: { "work:500": 1 }, clientEventLoopLag: {}, serverOperations: {} }));
    expect(text).toContain("RESULTAT: 1 krav bröts:\n  ✗ x");
    expect(text).toContain("Postgres: ej mätt");
    expect(text).toContain("Containrar: ej mätta");
    expect(text).toContain("Konvergens: ej kontrollerad");
    expect(text).toContain("  ej mätt");
    expect(text).toContain("event loop (p99/max ms per fas): ej mätt");
    expect(text).toContain("{\"work:500\":1}");
  });

  it("formatOperations: rubrik + en rad per anrop", () => {
    expect(formatOperations({ "a:b": summarize([1]) })).toHaveLength(2);
  });
});

describe("ActionTally", () => {
  it("räknar lyckade och misslyckade, sparar högst 10 exempel", async () => {
    const t = new ActionTally();
    expect(await t.run("a", () => Promise.resolve(1))).toBe(1);
    for (let i = 0; i < 12; i++) expect(await t.run("b", () => Promise.reject(new Error(`fel ${i}`)))).toBeUndefined();
    t.fail("c", "sträng");
    expect(t.failures).toBe(13);
    expect(t.toJSON().ok).toEqual({ a: 1 });
    expect(t.toJSON().failed).toEqual({ b: 12, c: 1 });
    expect(t.examples).toHaveLength(10);
    expect(t.examples[0]).toBe("b: fel 0");
  });
});

describe("avvisningar och byråer", () => {
  it("rejectionsSince ser bara nya avvisningar, med serverns skäl", async () => {
    const rejected = new RejectedChanges();
    const users = [{ rejected }];
    const entry = { mutationId: "m1", entity: "contact", kind: "create" as const, row: { id: "c1" }, enqueuedAt: 0 };
    await rejected.record([{ mutation: entry, conflictClass: "surface", reason: "gammal" }]);
    const before = rejectedCounts(users);
    expect(rejectionsSince(users, before)).toEqual({ count: 0, examples: [] });
    await rejected.record([{ mutation: { ...entry, mutationId: "m2" }, conflictClass: "surface", reason: "stale" }]);
    expect(rejectionsSince(users, before)).toEqual({ count: 1, examples: [expect.stringContaining("stale")] });
    expect(rejectionsSince(users, [])).toMatchObject({ count: 2 });
  });

  it("usersInOrg och dbFor", () => {
    const org = (index: number) => ({ index, organizationId: "o", serverUrl: "u", databaseUrl: "d" });
    const users = [{ user: { id: "1", email: "a", name: "A", org: org(1) } }, { user: { id: "2", email: "b", name: "B", org: org(2) } }];
    expect(usersInOrg({ users }, 2).map((u) => u.user.id)).toEqual(["2"]);
    expect(() => dbFor({ dbs: new Map() }, 1)).toThrow(/byrå 1/);
  });

  it("openJobs räknar jobb som inte är klara", () => {
    expect(openJobs({ created: 2, retry: 1, active: 3, completed: 9, failed: 1 })).toBe(6);
    expect(openJobs({})).toBe(0);
  });

  it("rowIdOf: anropets input.id eller radens id", () => {
    const call = { type: "procedure" as const, mutationId: "m", path: "timeEntry.create", input: { id: "t1" }, codeVersion: "x", touches: [], enqueuedAt: 0 };
    expect(rowIdOf(call)).toBe("t1");
    expect(rowIdOf({ ...call, input: {} })).toBe("");
    expect(rowIdOf({ mutationId: "m", entity: "contact", kind: "create", row: { id: "c1" }, enqueuedAt: 0 })).toBe("c1");
  });
});

describe("rng", () => {
  it("samma seed → samma följd; int inom gränserna; pick ur listan", () => {
    const a = rng(42);
    const b = rng(42);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    for (let i = 0; i < 50; i++) {
      const n = a.int(3, 5);
      expect(n >= 3 && n <= 5).toBe(true);
    }
    expect(["x", "y"]).toContain(a.pick(["x", "y"]));
    expect(a.pick([])).toBeUndefined();
  });

  it("exp: positiv och högst 5 × medel", () => {
    const r = rng(1);
    for (let i = 0; i < 100; i++) {
      const x = r.exp(100);
      expect(x >= 0 && x <= 500).toBe(true);
    }
  });

  it("weighted följer vikterna och hanterar tom lista", () => {
    const r = rng(7);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 1000; i++) {
      const k = weighted(r, [[9, "a"], [1, "b"]] as const);
      if (k) counts[k]++;
    }
    expect(counts.a).toBeGreaterThan(counts.b * 4);
    expect(weighted(r, [])).toBeUndefined();
    expect(weighted({ next: () => 0.999999, int: () => 0, pick: () => undefined, exp: () => 0 }, [[0, "x"], [0, "y"]] as const)).toBe("y");
  });
});

describe("failureCode", () => {
  it("tRPC-fel → status och kod; övriga fel → meddelandet", () => {
    const trpc = TRPCClientError.from({ error: { message: "boom", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } });
    expect(failureCode(trpc)).toBe("fel 500:INTERNAL_SERVER_ERROR");
    expect(failureCode(TRPCClientError.from(new Error("nät")))).toBe("fel: nät");
    expect(failureCode(new Error("x"))).toBe("fel: x");
    expect(failureCode("y")).toBe("fel");
  });
});
