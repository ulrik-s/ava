/**
 * `buildServerFirstApi` + `loadServerFirstConfig` (#410) — composition-root.
 * Wiring testas utan live-server (lat Postgres-connection); env-parsningen
 * testas mot ett explicit env-objekt.
 */

import { describe, it, expect } from "vitest-compat";
import {
  buildServerFirstApi,
  loadServerFirstConfig,
  SERVER_FIRST_ENV,
} from "@/lib/server/http/server-first-api";

describe("buildServerFirstApi", () => {
  it("bygger { handler, close } ur en config (lat connection)", async () => {
    const api = buildServerFirstApi({
      databaseUrl: "postgres://ava:ava@127.0.0.1:1/ava_test",
      organizationId: "org-1",
      maxConnections: 1,
    });
    expect(typeof api.handler).toBe("function");
    await expect(api.close()).resolves.toBeUndefined();
  });
});

describe("loadServerFirstConfig", () => {
  const base = {
    [SERVER_FIRST_ENV.databaseUrl]: "postgres://db/x",
    [SERVER_FIRST_ENV.organizationId]: "org-1",
  };

  it("läser obligatoriska + default-värden", () => {
    expect(loadServerFirstConfig(base)).toEqual({
      databaseUrl: "postgres://db/x",
      organizationId: "org-1",
      httpPort: 3001,
      httpHost: "127.0.0.1",
    });
  });

  it("läser custom port/host", () => {
    const cfg = loadServerFirstConfig({
      ...base,
      [SERVER_FIRST_ENV.httpPort]: "8088",
      [SERVER_FIRST_ENV.httpHost]: "0.0.0.0",
    });
    expect(cfg).toMatchObject({ httpPort: 8088, httpHost: "0.0.0.0" });
  });

  it("kastar utan databas-URL", () => {
    expect(() => loadServerFirstConfig({ [SERVER_FIRST_ENV.organizationId]: "org-1" })).toThrow(
      SERVER_FIRST_ENV.databaseUrl,
    );
  });

  it("kastar utan organizationId", () => {
    expect(() => loadServerFirstConfig({ [SERVER_FIRST_ENV.databaseUrl]: "postgres://db/x" })).toThrow(
      SERVER_FIRST_ENV.organizationId,
    );
  });
});
