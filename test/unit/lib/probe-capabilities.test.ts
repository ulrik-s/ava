/**
 * `probeCapabilities` (ADR 0027 / #641) — server-probe med timeout/fail → null.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { probeCapabilities } from "@/lib/client/capabilities/probe-capabilities";
import { SELF_HOSTED_CAPABILITIES } from "@/lib/shared/capabilities";

const queryMock = vi.fn();
vi.mock("@trpc/client", () => ({
  createTRPCClient: () => ({ system: { capabilities: { query: queryMock } } }),
  httpBatchLink: () => ({}),
}));
vi.mock("@/lib/client/backend/http-backend-runtime", () => ({
  serverTrpcEndpoint: () => "http://server/api/trpc",
}));

describe("probeCapabilities", () => {
  beforeEach(() => queryMock.mockReset());
  afterEach(() => vi.useRealTimers());

  it("returnerar serverns annonserade caps vid svar", async () => {
    queryMock.mockReturnValue(Promise.resolve(SELF_HOSTED_CAPABILITIES));
    expect(await probeCapabilities()).toEqual(SELF_HOSTED_CAPABILITIES);
  });

  it("null när servern svarar med fel (ingen server / nere)", async () => {
    queryMock.mockReturnValue(Promise.reject(new Error("ECONNREFUSED")));
    expect(await probeCapabilities()).toBeNull();
  });

  it("null vid timeout (server hänger)", async () => {
    vi.useFakeTimers();
    queryMock.mockReturnValue(new Promise(() => {})); // resolvar aldrig
    const p = probeCapabilities();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await p).toBeNull();
  });
});
