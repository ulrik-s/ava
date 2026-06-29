/**
 * `createHttpCaller` (#846) — en `GeneratorCaller` som kör demo-populeringen via
 * serverns RIKTIGA HTTP-API (`/api/trpc`) i stället för in-process `createCaller`.
 *
 * Varför: då testas hela kedjan som UI:t faktiskt använder — superjson-transport,
 * oauth2-proxy + Bearer-JWT-auth (ADR 0009/0028) och server-routrarna mot Postgres
 * — inte bara routrarna isolerat. Samma `populate*`-kod återanvänds oförändrat.
 *
 * Formen speglar `appRouter.createCaller`: `caller.x.y(input) => Promise`. En Proxy
 * slår upp om `x.y` är query/mutation (ur `appRouter._def.procedures`) och anropar
 * httpBatchLink-klientens `.query`/`.mutate`. Transformern (superjson) + auth-headern
 * matchar `HttpBackendRuntime`.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { appRouter, type AppRouter } from "@/lib/server/routers/_app";
import type { GeneratorCaller } from "./backend-target";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** query/mutation för en dotted procedure-path, ur routerns definition. */
function procType(path: string): "query" | "mutation" | undefined {
  return (appRouter as Any)._def.procedures[path]?._def?.type;
}

export interface HttpCallerOpts {
  /** Full tRPC-endpoint, t.ex. `http://localhost:8080/api/trpc`. */
  trpcUrl: string;
  /** Bearer-JWT — verifieras av servern mot IdP:ns JWKS (ADR 0028 §1). */
  token: string;
}

export function createHttpCaller(opts: HttpCallerOpts): GeneratorCaller {
  const client = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: opts.trpcUrl,
      transformer: superjson,
      headers: () => ({ authorization: `Bearer ${opts.token}` }),
    })],
  });
  const make = (path: string): Any =>
    new Proxy(() => {}, {
      get: (_t, key) => (typeof key === "string" ? make(path ? `${path}.${key}` : key) : undefined),
      apply: (_t, _this, args: Any[]) => {
        const node = path.split(".").reduce((o: Any, k) => o[k], client as Any);
        return procType(path) === "query" ? node.query(args[0]) : node.mutate(args[0]);
      },
    });
  return make("") as GeneratorCaller;
}

export interface MintTokenOpts {
  kcBaseUrl: string; realm: string; clientId: string; clientSecret: string;
  username: string; password: string;
}

/** Hämta en access-token via OIDC password-grant (dev-fixturen: `ava`-klienten
 *  har directAccessGrants + secret). Endast för lokal seedning, aldrig i prod.
 *
 *  Retry med backoff: seedningen kan köra innan Keycloaks realm-token-endpoint
 *  är helt redo (#846) → nät-/5xx-fel rätas ut av ett par försök. */
/** Ett token-försök. Returnerar token, eller "retry" vid transient fel (nät/5xx).
 *  Kastar vid icke-transient fel (fel creds/klient, saknad token). */
async function attemptToken(url: string, body: URLSearchParams): Promise<string | "retry"> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  } catch {
    return "retry"; // KC ej uppe än
  }
  if (res.ok) {
    const json = (await res.json()) as { access_token?: string };
    if (json.access_token) return json.access_token;
    throw new Error("Keycloak: inget access_token i svaret");
  }
  if (res.status < 500) throw new Error(`Keycloak token ${res.status}: ${await res.text()}`);
  return "retry"; // 5xx
}

export async function mintToken(opts: MintTokenOpts, retries = 15): Promise<string> {
  const url = `${opts.kcBaseUrl}/realms/${opts.realm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "password", client_id: opts.clientId, client_secret: opts.clientSecret,
    username: opts.username, password: opts.password, scope: "openid email profile",
  });
  for (let attempt = 1; ; attempt++) {
    const result = await attemptToken(url, body);
    if (result !== "retry") return result;
    if (attempt >= retries) throw new Error("Keycloak: token-endpoint ej redo efter retries");
    await new Promise((r) => setTimeout(r, 1000));
  }
}
