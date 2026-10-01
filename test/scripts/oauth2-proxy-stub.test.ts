/**
 * Låtsas-oauth2-proxyn i Caddy-E2E:n (#1352) — svarar som oauth2-proxy gör
 * för en inloggad användare, och skickar bara tillbaka till samma origin.
 */
import { describe, expect, it } from "vitest-compat";
import { STUB_EMAIL, stubReply } from "../../tooling/scripts/caddy-e2e/oauth2-proxy-stub";

describe("oauth2-proxy-stub", () => {
  it("userinfo ger claims för E2E-användaren", () => {
    const r = stubReply("/oauth2/userinfo", "e2e@byra.se");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ email: "e2e@byra.se", user: "e2e", preferredUsername: "e2e@byra.se" });
  });

  it("auth ger 202 med den verifierade e-posten (forward_auth kopierar den)", () => {
    expect(stubReply("/oauth2/auth", "e2e@byra.se")).toEqual({ status: 202, headers: { "X-Auth-Request-Email": "e2e@byra.se" }, body: "" });
  });

  it("start skickar tillbaka till rd — bara en sökväg på samma origin", () => {
    expect(stubReply("/oauth2/start?rd=%2Fmatters%2F").headers.Location).toBe("/matters/");
    expect(stubReply("/oauth2/start?rd=https%3A%2F%2Fevil.example").headers.Location).toBe("/");
    expect(stubReply("/oauth2/start?rd=%2F%2Fevil.example").headers.Location).toBe("/");
    expect(stubReply("/oauth2/start").headers.Location).toBe("/");
  });

  it("allt annat 404; default-e-posten är den seedade", () => {
    expect(stubReply("/oauth2/other").status).toBe(404);
    expect(STUB_EMAIL).toBe("caddy-e2e@byra.se");
    expect(JSON.parse(stubReply("/oauth2/userinfo").body)).toMatchObject({ email: STUB_EMAIL });
  });
});
