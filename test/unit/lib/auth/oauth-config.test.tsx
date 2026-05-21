/**
 * Tester för OAuth-config — round-trip + isOAuthConfigured.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from "vitest";
import { loadOAuthConfig, saveOAuthConfig, isOAuthConfigured } from "@/lib/auth/oauth-config";

beforeEach(() => localStorage.clear());

describe("oauth-config", () => {
  it("default = tomma fält", () => {
    expect(loadOAuthConfig()).toEqual({ proxyUrl: "", clientId: "" });
  });

  it("save + load round-trip", () => {
    saveOAuthConfig({ proxyUrl: "https://w.example.com", clientId: "Ov23li_abc" });
    expect(loadOAuthConfig()).toEqual({ proxyUrl: "https://w.example.com", clientId: "Ov23li_abc" });
  });

  it("isOAuthConfigured kräver båda fälten", () => {
    expect(isOAuthConfigured({ proxyUrl: "", clientId: "" })).toBe(false);
    expect(isOAuthConfigured({ proxyUrl: "x", clientId: "" })).toBe(false);
    expect(isOAuthConfigured({ proxyUrl: "", clientId: "y" })).toBe(false);
    expect(isOAuthConfigured({ proxyUrl: "x", clientId: "y" })).toBe(true);
  });

  it("korrupt JSON → default", () => {
    localStorage.setItem("ava.oauthConfig", "{not-json");
    expect(loadOAuthConfig()).toEqual({ proxyUrl: "", clientId: "" });
  });
});
