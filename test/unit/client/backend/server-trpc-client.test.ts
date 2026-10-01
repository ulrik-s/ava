/**
 * `loadServerHelperConfig` (#1161) — helper-configen läses från SERVERN
 * (`/api/trpc`), inte via klientens in-process-tRPC (där serverns env saknas
 * och svaret alltid blev null).
 */
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { loadServerEndSessionUrl, loadServerHelperConfig } from "@/lib/client/backend/server-trpc-client";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

/** tRPC:s batch-svar (superjson) för en query. */
const trpcResponse = (json: unknown): Response =>
  new Response(JSON.stringify([{ result: { data: { json } } }]), { status: 200, headers: { "Content-Type": "application/json" } });

describe("loadServerHelperConfig", () => {
  it("frågar serverns /api/trpc efter system.helperConfig och ger configen", async () => {
    const cfg = { oidcIssuer: "https://login.example/v2.0", oidcClientId: "ava-helper", oidcScope: "api://x/access_as_user" };
    const fetchMock = vi.fn(async () => trpcResponse(cfg));
    global.fetch = fetchMock;
    expect(await loadServerHelperConfig()).toEqual(cfg);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/trpc\/system\.helperConfig/);
  });

  it("servern utan helper-inloggning → null", async () => {
    global.fetch = vi.fn(async () => trpcResponse(null));
    expect(await loadServerHelperConfig()).toBeNull();
  });
});

describe("loadServerEndSessionUrl (#1347)", () => {
  it("frågar serverns system.signOutConfig och ger IdP:ns utloggnings-URL", async () => {
    const fetchMock = vi.fn(async () => trpcResponse({ endSessionUrl: "https://idp.example/logout" }));
    global.fetch = fetchMock;
    expect(await loadServerEndSessionUrl()).toBe("https://idp.example/logout");
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/trpc\/system\.signOutConfig/);
  });
});
