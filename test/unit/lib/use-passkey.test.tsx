/**
 * Tester för `usePasskey`-hooken.
 *
 * Mockar @simplewebauthn/browser så vi inte beror på riktig
 * Credentials-API i jsdom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePasskey } from "@/client/lib/use-passkey";

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));

import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

const sr = startRegistration as ReturnType<typeof vi.fn>;
const sa = startAuthentication as ReturnType<typeof vi.fn>;

describe("usePasskey.register", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sr.mockResolvedValue({ id: "new-cred-id", rawId: "x", type: "public-key", response: {}, clientExtensionResults: {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/passkey/register/begin")) {
        return new Response(JSON.stringify({ challenge: "abc" }), { status: 200 });
      }
      if (url.endsWith("/passkey/register/finish")) {
        return new Response(JSON.stringify({ ok: true, passkeyId: "new-cred-id" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("anropar begin + browser.startRegistration + finish", async () => {
    const { result } = renderHook(() => usePasskey());
    await act(async () => { await result.current.register("MacBook"); });
    expect(sr).toHaveBeenCalled();
    expect(result.current.status).toBe("success");
  });

  it("börjar i idle och slutar i success vid lyckad register", async () => {
    const { result } = renderHook(() => usePasskey());
    expect(result.current.status).toBe("idle");
    await act(async () => { await result.current.register(); });
    expect(result.current.status).toBe("success");
  });

  it("status → error om browser.startRegistration kastar", async () => {
    sr.mockRejectedValue(new Error("Användaren avbröt"));
    const { result } = renderHook(() => usePasskey());
    await act(async () => {
      await result.current.register().catch(() => undefined);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/avbr/i);
  });
});

describe("usePasskey.authenticate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sa.mockResolvedValue({ id: "cred", rawId: "x", type: "public-key", response: {}, clientExtensionResults: {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/passkey/authenticate/begin")) {
        return new Response(JSON.stringify({ challenge: "x" }), { status: 200 });
      }
      if (url.endsWith("/passkey/authenticate/finish")) {
        return new Response(JSON.stringify({ ok: true, userId: "u1" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returnerar userId vid lyckad authenticate", async () => {
    const { result } = renderHook(() => usePasskey());
    let userId: string | undefined;
    await act(async () => { userId = await result.current.authenticate(); });
    expect(userId).toBe("u1");
    expect(result.current.status).toBe("success");
  });

  it("kastar och sätter error om verify fail:ar", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/passkey/authenticate/begin")) {
        return new Response(JSON.stringify({ challenge: "x" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }));
    const { result } = renderHook(() => usePasskey());
    await act(async () => {
      try { await result.current.authenticate(); } catch { /* */ }
    });
    expect(result.current.status).toBe("error");
  });
});
