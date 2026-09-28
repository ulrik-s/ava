/**
 * tRPC-klient mot den fulla self-hosted-stacken med ett Keycloak-token (Bearer →
 * oauth2-proxy → server-first) — samma nätväg som helpern/add-ins. Delas av
 * `conflict-seed.ts` och e2e-specarna under `test/e2e/conflict/`.
 */
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";

const WEB_URL = process.env.AVA_WEB_URL ?? "http://localhost:8080";
const KC_URL = process.env.OIDC_KC_HOSTNAME ?? "http://localhost:8089";

/** Hämta ett access-token för en testanvändare (password grant, test-realmen). */
export async function mintToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${KC_URL}/realms/ava/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password", client_id: "ava", client_secret: "ava-test-secret",
      username, password, scope: "openid email profile",
    }),
  });
  if (!res.ok) throw new Error(`token-mint ${username}: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error(`token-mint ${username}: saknar access_token`);
  return json.access_token;
}

/** tRPC-klient som anropar serverns `appRouter` direkt över HTTP. */
export function clientFor(token: string): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: `${WEB_URL}/api/trpc`,
      transformer: superjson,
      headers: () => ({ Authorization: `Bearer ${token}` }),
    })],
  });
}
