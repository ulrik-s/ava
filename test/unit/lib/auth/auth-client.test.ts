/**
 * Tester för auth-client. Mockar fetch och verifierar request-formerna.
 */

import { describe, it, expect, vi } from "vitest";
import { createAuthClient } from "@/client/lib/auth/auth-client";

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string, init?: RequestInit) => handler(url, init)) as unknown as typeof fetch;
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createAuthClient", () => {
  it("status hämtar GET /status", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("/auth/status");
      expect(init?.method ?? "GET").toBe("GET");
      return jsonRes(200, { hasAdmin: true, totalUsers: 3 });
    });
    const c = createAuthClient({ fetchFn: f });
    const s = await c.status();
    expect(s.hasAdmin).toBe(true);
    expect(s.totalUsers).toBe(3);
  });

  it("bootstrap POST:ar JSON-body", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("/auth/bootstrap");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({ secret: "s", email: "a@b" });
      return jsonRes(200, { email: "a@b", token: "pat", role: "ADMIN" });
    });
    const c = createAuthClient({ fetchFn: f });
    const r = await c.bootstrap({ secret: "s", email: "a@b" });
    expect(r.token).toBe("pat");
  });

  it("redeemInvite POST:ar mot rätt path", async () => {
    const f = mockFetch((url) => {
      expect(url).toBe("/auth/redeem-invite");
      return jsonRes(200, { email: "x", token: "y", role: "LAWYER" });
    });
    const c = createAuthClient({ fetchFn: f });
    await c.redeemInvite({ inviteToken: "tok", email: "x" });
  });

  it("invite returnerar inviteToken + expiresAt", async () => {
    const f = mockFetch(() => jsonRes(200, { inviteToken: "iv", expiresAt: "2026-12-01T00:00:00Z" }));
    const c = createAuthClient({ fetchFn: f });
    const r = await c.invite({ adminEmail: "a", adminToken: "t", email: "b", role: "LAWYER" });
    expect(r.inviteToken).toBe("iv");
  });

  it("kastar med error-meddelande från servern vid 4xx", async () => {
    const f = mockFetch(() => jsonRes(403, { error: "Felaktig bootstrap-secret" }));
    const c = createAuthClient({ fetchFn: f });
    await expect(c.bootstrap({ secret: "wrong", email: "a@b" })).rejects.toThrow(/Felaktig bootstrap/);
  });

  it("custom baseUrl används", async () => {
    const f = mockFetch((url) => {
      expect(url).toBe("https://example.com/api/status");
      return jsonRes(200, { hasAdmin: false, totalUsers: 0 });
    });
    const c = createAuthClient({ fetchFn: f, baseUrl: "https://example.com/api" });
    await c.status();
  });
});
