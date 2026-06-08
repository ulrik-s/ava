/**
 * Tester för integrationsregistry — singleton-Map över connectors.
 */

import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import type { IntegrationConnector } from "@/lib/client/integrations/types";

function makeConnector(id: string, displayName = id): IntegrationConnector {
  return {
    id,
    displayName,
    capabilities: ["mail"],
    getStatus: vi.fn(async () => ({ kind: "disconnected" as const })),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => "tok"),
    subscribe: vi.fn(() => () => {}),
  };
}

// Singleton — töm registret mellan tester (bun:test saknar vi.resetModules).
beforeEach(async () => {
  const { clearConnectors } = await import("@/lib/client/integrations/registry");
  clearConnectors();
});

describe("integrations/registry", () => {
  it("returnerar undefined för okänd connector", async () => {
    const { getConnector } = await import("@/lib/client/integrations/registry");
    expect(getConnector("nope")).toBeUndefined();
  });

  it("registerConnector + getConnector returnerar samma instans", async () => {
    const { registerConnector, getConnector } = await import("@/lib/client/integrations/registry");
    const c = makeConnector("o365", "Office 365");
    registerConnector(c);
    expect(getConnector("o365")).toBe(c);
  });

  it("registerConnector ersätter befintlig connector med samma id", async () => {
    const { registerConnector, getConnector } = await import("@/lib/client/integrations/registry");
    const a = makeConnector("foo", "v1");
    const b = makeConnector("foo", "v2");
    registerConnector(a);
    registerConnector(b);
    expect(getConnector("foo")?.displayName).toBe("v2");
  });

  it("listConnectors returnerar alla registrerade", async () => {
    const { registerConnector, listConnectors } = await import("@/lib/client/integrations/registry");
    registerConnector(makeConnector("o365"));
    registerConnector(makeConnector("google"));
    expect(listConnectors().map((c) => c.id).sort()).toEqual(["google", "o365"]);
  });

  it("listConnectors är tom när inga registrerats", async () => {
    const { listConnectors } = await import("@/lib/client/integrations/registry");
    expect(listConnectors()).toEqual([]);
  });
});
