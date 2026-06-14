/**
 * Tester för `WebOAuthDeviceFlow` state-machine (#61): requesting → waiting,
 * fel-grenen, avbryt, och token-polling → onComplete.
 *
 */
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { WebOAuthDeviceFlow, classifyTokenResponse } from "@/components/settings/web-oauth-device-flow";

vi.mock("@/lib/client/auth/oauth-config", () => ({
  loadOAuthConfig: () => ({ proxyUrl: "https://proxy.test", clientId: "cid" }),
}));

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); vi.clearAllMocks(); });

const deviceCode = {
  device_code: "dev-123", user_code: "WXYZ-9876",
  verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5,
};

function mockFetch(handler: (url: string) => unknown) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) =>
    new Response(JSON.stringify(handler(String(url))), { status: 200 }),
  ) as typeof fetch;
}

describe("WebOAuthDeviceFlow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requesting → waiting: visar user_code + verification_uri", async () => {
    mockFetch(() => deviceCode);
    render(<WebOAuthDeviceFlow onComplete={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("WXYZ-9876")).toBeInTheDocument());
    expect(screen.getByText(/github.com\/login\/device/)).toBeInTheDocument();
  });

  it("fel vid device/code → error-grenen + Stäng-knapp", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;
    render(<WebOAuthDeviceFlow onComplete={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Inloggning misslyckades")).toBeInTheDocument());
    expect(screen.getByText("Stäng")).toBeInTheDocument();
  });

  it("Avbryt anropar onCancel", async () => {
    mockFetch(() => deviceCode);
    const onCancel = vi.fn();
    render(<WebOAuthDeviceFlow onComplete={vi.fn()} onCancel={onCancel} />);
    await waitFor(() => screen.getByText("Avbryt"));
    fireEvent.click(screen.getByText("Avbryt"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("pollar /token efter interval och anropar onComplete vid access_token", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async (url: string | URL | Request) =>
      new Response(JSON.stringify(String(url).endsWith("/token") ? { access_token: "tok-abc" } : deviceCode), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as typeof fetch;
    const onComplete = vi.fn();
    render(<WebOAuthDeviceFlow onComplete={onComplete} onCancel={vi.fn()} />);
    // Stegvis: flush mount/cfg/device-code → waiting, fira sedan poll-timern.
    // act() krävs så React-state-uppdateringar (cfg/code) flushas mellan varven.
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5001);
      });
    }
    const calledToken = fetchSpy.mock.calls.some(([u]: unknown[]) => String(u).endsWith("/token"));
    expect(calledToken).toBe(true);
    expect(onComplete).toHaveBeenCalledWith("tok-abc");
  });

  it("terminalt token-fel → error-grenen", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (url: string | URL | Request) =>
      new Response(JSON.stringify(
        String(url).endsWith("/token")
          ? { error: "access_denied", error_description: "Användaren nekade åtkomst" }
          : deviceCode,
      ), { status: 200 }),
    ) as typeof fetch;
    render(<WebOAuthDeviceFlow onComplete={vi.fn()} onCancel={vi.fn()} />);
    for (let i = 0; i < 6; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
    }
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText("Inloggning misslyckades")).toBeInTheDocument());
    expect(screen.getByText("Användaren nekade åtkomst")).toBeInTheDocument();
  });
});

describe("classifyTokenResponse", () => {
  it("access_token → token-utfall", () => {
    expect(classifyTokenResponse({ access_token: "tok-1" })).toEqual({ token: "tok-1" });
  });
  it("authorization_pending/slow_down → pending (fortsätt polla)", () => {
    expect(classifyTokenResponse({ error: "authorization_pending" })).toBe("pending");
    expect(classifyTokenResponse({ error: "slow_down" })).toBe("pending");
    expect(classifyTokenResponse({})).toBe("pending");
  });
  it("terminalt fel → error-utfall (error_description prioriteras)", () => {
    expect(classifyTokenResponse({ error: "access_denied", error_description: "nekad" }))
      .toEqual({ error: "nekad" });
    expect(classifyTokenResponse({ error: "expired_token" }))
      .toEqual({ error: "expired_token" });
  });
});
