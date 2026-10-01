#!/usr/bin/env bun
/**
 * Låtsas-oauth2-proxy för Caddy-E2E:n (#1352) — står på `oauth2-proxy:4180`
 * där prod-Caddyfile:n letar, så den RIKTIGA Caddyfile:n kan köras utan IdP.
 *
 *   - `/oauth2/userinfo` → claims för E2E-användaren (sessionsgrinden binder den)
 *   - `/oauth2/auth`     → 202 + `X-Auth-Request-Email` (Caddys `forward_auth`
 *     kopierar den till server-first, som i prod)
 *   - `/oauth2/start`    → tillbaka till `rd`, som efter en lyckad inloggning
 *
 * Bara för test: en riktig proxy verifierar en OIDC-session först.
 */

import { createServer } from "node:http";

/** E2E-användarens e-post — samma som caddy-prod-e2e.sh seedar som admin. */
export const STUB_EMAIL = process.env.AVA_STUB_EMAIL ?? "caddy-e2e@byra.se";

/** Ett svar från låtsas-proxyn. */
export interface StubReply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** `rd` bara som sökväg på samma origin (som oauth2-proxy:s egen kontroll). */
function sameOriginPath(rd: string | null): string {
  return rd !== null && rd.startsWith("/") && !rd.startsWith("//") ? rd : "/";
}

/** Svaret oauth2-proxy skulle ge en inloggad `email` på `rawUrl`. */
export function stubReply(rawUrl: string, email: string = STUB_EMAIL): StubReply {
  const url = new URL(rawUrl, "http://oauth2-proxy");
  switch (url.pathname) {
    case "/oauth2/userinfo": {
      const claims = { email, user: email.split("@")[0], preferredUsername: email };
      return { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(claims) };
    }
    case "/oauth2/auth":
      return { status: 202, headers: { "X-Auth-Request-Email": email }, body: "" };
    case "/oauth2/start":
      return { status: 302, headers: { Location: sameOriginPath(url.searchParams.get("rd")) }, body: "" };
    default:
      return { status: 404, headers: {}, body: "not found" };
  }
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4180);
  createServer((req, res) => {
    const reply = stubReply(req.url ?? "/");
    res.writeHead(reply.status, reply.headers).end(reply.body);
  }).listen(port, "0.0.0.0", () => console.log(`[oauth2-proxy-stub] ${STUB_EMAIL} på :${port}`));
}
