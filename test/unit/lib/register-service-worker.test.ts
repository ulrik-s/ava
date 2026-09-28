/**
 * Tester för `registerServiceWorker`-funktionen.
 *
 * Vi mockar `navigator.serviceWorker` så testen körs utan en riktig
 * SW-runtime.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { registerServiceWorker } from "@/lib/client/register-service-worker";

describe("registerServiceWorker", () => {
  beforeEach(() => { vi.stubGlobal("window", {}); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returnerar `unsupported` om navigator.serviceWorker saknas", async () => {
    vi.stubGlobal("navigator", {});
    const result = await registerServiceWorker("/sw.js");
    expect(result.status).toBe("unsupported");
  });

  it("anropar navigator.serviceWorker.register med given URL", async () => {
    const register = vi.fn(async () => ({ scope: "/" }));
    vi.stubGlobal("navigator", { serviceWorker: { register, ready: Promise.resolve({}) } });
    const result = await registerServiceWorker("/sw.js");
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(result.status).toBe("registered");
  });

  it("skickar vidare scope (under-sökväg, t.ex. GH Pages /ava/) och returnerar registreringen", async () => {
    const registration = { scope: "https://x/ava/" };
    const register = vi.fn(async () => registration);
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const result = await registerServiceWorker("/ava/sw.js", "/ava/");
    expect(register).toHaveBeenCalledWith("/ava/sw.js", { scope: "/ava/" });
    expect(result.registration).toBe(registration);
    expect(result.scope).toBe("https://x/ava/");
  });

  it("returnerar `failed` om register kastar", async () => {
    const register = vi.fn(async () => { throw new Error("SSL invalid"); });
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await registerServiceWorker("/sw.js");
    expect(result.status).toBe("failed");
    expect(result.error?.message).toMatch(/SSL invalid/);
    expect(result.registration).toBeUndefined();
    spy.mockRestore();
  });

  it("är no-op när window saknas (SSR-kontekst)", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn() } });
    vi.stubGlobal("window", undefined);
    const result = await registerServiceWorker("/sw.js");
    expect(result.status).toBe("unsupported");
  });
});
