/**
 * Lasttestets konfiguration (#1366): miljön tolkas med zod, defaults ger
 * CI-körningen, och gränserna följer issuets krav.
 */
import { describe, expect, it } from "vitest-compat";
import { databaseName, orgId, parseLoadConfig, SOAK_DURATION_S } from "../../../../tooling/load/config";

describe("parseLoadConfig", () => {
  it("defaults: 20 användare i 2 byråer, alla scenarier, issuets gränser", () => {
    const c = parseLoadConfig({});
    expect(c.users).toBe(20);
    expect(c.orgs).toHaveLength(2);
    expect(c.scenarios).toEqual(["work", "storm", "invoice", "documents", "idempotency"]);
    expect(c.durationS).toBe(60);
    expect(c.thresholds).toEqual({
      maxP95Ms: 500,
      p95Ops: ["sync.pull", "sync.push", "sync.replay", "sync.reportDevice", "document.search", "document.downloadContent"],
      max5xx: 0,
      maxDrainS: 120,
      maxLockWaitMs: 1000,
      maxDeadlocks: 0,
      maxJobDrainS: 120,
      maxServerMemMiB: null,
    });
    expect(c.pgContainer).toBeNull();
    expect(c.containers).toEqual([]);
  });

  it("byråerna får fasta id:n, egna portar och egna databaser", () => {
    const c = parseLoadConfig({ LOAD_ORGS: "3", LOAD_PORT_BASE: "40000", LOAD_PG_PORT: "41000", LOAD_HOST: "h" });
    expect(c.orgs.map((o) => o.serverUrl)).toEqual(["http://h:40001", "http://h:40002", "http://h:40003"]);
    expect(c.orgs[2]).toEqual({
      index: 3, organizationId: orgId(3), serverUrl: "http://h:40003", databaseUrl: `postgres://ava:ava@h:41000/${databaseName(3)}`,
    });
    expect(c.adminDatabaseUrl).toBe(c.orgs[0]?.databaseUrl);
  });

  it("byrå-id:t är det compose-filen sätter", () => {
    expect(orgId(1)).toBe("00000000-0000-7000-8000-000001366001");
    expect(databaseName(2)).toBe("ava_load_2");
  });

  it("dräneringsgränsen: 2 min upp till 20 användare, 5 min över, eller explicit", () => {
    expect(parseLoadConfig({ LOAD_USERS: "20" }).thresholds.maxDrainS).toBe(120);
    expect(parseLoadConfig({ LOAD_USERS: "50" }).thresholds.maxDrainS).toBe(300);
    expect(parseLoadConfig({ LOAD_USERS: "50", LOAD_MAX_DRAIN_S: "42" }).thresholds.maxDrainS).toBe(42);
  });

  it("LOAD_SOAK=1 ger 30 minuters vanligt arbete", () => {
    expect(parseLoadConfig({ LOAD_SOAK: "1", LOAD_DURATION_S: "10" }).durationS).toBe(SOAK_DURATION_S);
  });

  it("listor tolkas med trim och tomma poster bortfiltrerade", () => {
    const c = parseLoadConfig({ LOAD_SCENARIOS: " storm, ,invoice ", LOAD_P95_OPS: "a, b", LOAD_CONTAINERS: "x,y,", LOAD_PG_CONTAINER: "pg" });
    expect(c.scenarios).toEqual(["storm", "invoice"]);
    expect(c.thresholds.p95Ops).toEqual(["a", "b"]);
    expect(c.containers).toEqual(["x", "y"]);
    expect(c.pgContainer).toBe("pg");
  });

  it("minnesgränsen är valfri", () => {
    expect(parseLoadConfig({ LOAD_MAX_SERVER_MEM_MIB: "1024" }).thresholds.maxServerMemMiB).toBe(1024);
  });

  it("ogiltiga värden ger ett fel, inte NaN", () => {
    expect(() => parseLoadConfig({ LOAD_USERS: "många" })).toThrow();
    expect(() => parseLoadConfig({ LOAD_USERS: "0" })).toThrow();
    expect(() => parseLoadConfig({ LOAD_ORGS: "4" })).toThrow();
    expect(() => parseLoadConfig({ LOAD_SCENARIOS: "work,okänt" })).toThrow();
    expect(() => parseLoadConfig({ LOAD_SCENARIOS: "," })).toThrow();
    expect(() => parseLoadConfig({ LOAD_TABS: "1" })).toThrow();
  });

  it("offline-intervallet måste vara stigande", () => {
    expect(() => parseLoadConfig({ LOAD_OFFLINE_MIN: "300", LOAD_OFFLINE_MAX: "200" })).toThrow(/LOAD_OFFLINE_MIN/);
  });
});
