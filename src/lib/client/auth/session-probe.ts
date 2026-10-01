/**
 * Sessionsfrågan mot oauth2-proxy (#1245, #1351): vad vet vi om inloggningen?
 *
 * Bara ett svar som oauth2-proxy själv gett räknas. Allt annat — ett avbrott,
 * en omdirigering, en captive portal som svarar med sin egen HTML-sida, ett
 * svar som aldrig kommer — är "vet inte", och då bestämmer offline-graceperioden
 * i `session-gate.ts`, inte en hård omdirigering till IdP:n.
 *
 * | Svar på `/oauth2/userinfo`                 | Utfall                         |
 * |--------------------------------------------|--------------------------------|
 * | 200 + JSON med email                       | `authenticated`                |
 * | 401                                        | `signed-out` (bekräftat)       |
 * | 404                                        | `absent` (ingen OIDC i driften)|
 * | nätverksfel                                | `unreachable` / `network`      |
 * | inget svar inom 3 s                        | `unreachable` / `timeout`      |
 * | 5xx                                        | `unreachable` / `server-error` |
 * | omdirigering (3xx, `opaqueredirect`)       | `unreachable` / `redirect`     |
 * | annan 4xx (400, 403, 407, 429 …)           | `unreachable` / `unexpected-status` |
 * | 200 med HTML, annan typ, JSON utan email   | `unreachable` / `unexpected-content` |
 */

import { z } from "zod";
import type { OidcClaims } from "@/lib/server/auth/oidc-auth-provider";

/** Default-endpoint oauth2-proxy exponerar (samma origin som appen). */
export const OIDC_USERINFO_PATH = "/oauth2/userinfo";

/** Längsta väntan på svaret (#1351) — appstarten får aldrig hänga på proxyn. */
export const SESSION_PROBE_TIMEOUT_MS = 3_000;

/** Varför svaret inte gick att tolka som ett besked om sessionen. */
export type UnreachableReason = "network" | "timeout" | "server-error" | "redirect" | "unexpected-status" | "unexpected-content";

/** Sessionens läge enligt oauth2-proxy. */
export type SessionProbe =
  | { kind: "authenticated"; claims: OidcClaims }
  | { kind: "signed-out" }
  | { kind: "unreachable"; reason: UnreachableReason }
  | { kind: "absent" };

/** Delmängd av oauth2-proxy:s `/oauth2/userinfo`-svar vi använder. */
const userinfoSchema = z
  .object({
    email: z.string().default(""),
    user: z.string().default(""),
    preferredUsername: z.string().optional(),
  })
  .passthrough();

const unreachable = (reason: UnreachableReason): SessionProbe => ({ kind: "unreachable", reason });

/** Status utan 2xx → läge. Bara 401 är proxyns besked om att sessionen saknas. */
function probeFromStatus(status: number): SessionProbe {
  if (status === 401) return { kind: "signed-out" };
  if (status === 404) return { kind: "absent" };
  if (status >= 500) return unreachable("server-error");
  return unreachable(status >= 300 && status < 400 ? "redirect" : "unexpected-status");
}

/** Claims ur userinfo-svaret, eller null om det saknar email. */
function claimsFrom(body: unknown): OidcClaims | null {
  const info = userinfoSchema.safeParse(body);
  if (!info.success || !info.data.email) return null;
  return { email: info.data.email, subject: "", issuer: "", name: info.data.preferredUsername ?? info.data.user };
}

async function probeFromResponse(res: Response): Promise<SessionProbe> {
  if (res.type === "opaqueredirect") return unreachable("redirect");
  if (!res.ok) return probeFromStatus(res.status);
  // En captive portal (eller en server utan proxyn) svarar 200 med HTML.
  if (!(res.headers.get("content-type") ?? "").includes("json")) return unreachable("unexpected-content");
  const claims = claimsFrom(await res.json());
  return claims ? { kind: "authenticated", claims } : unreachable("unexpected-content");
}

/** Felet bakom ett uteblivet besked: trasig JSON, vår timeout, eller nätet. */
function reasonFor(err: unknown, signal: AbortSignal): UnreachableReason {
  if (err instanceof SyntaxError) return "unexpected-content";
  return signal.aborted ? "timeout" : "network";
}

/** Det probet behöver injicerat i tester. */
export interface SessionProbeOptions {
  fetchFn?: typeof globalThis.fetch;
  path?: string;
  timeoutMs?: number;
}

/**
 * Fråga oauth2-proxy om sessionen. En omdirigering följs inte — den vore en
 * korsdomän-dans till IdP:n. Hela svaret (också kroppen) måste komma inom
 * `timeoutMs`; annars är svaret "nås inte".
 */
export async function probeSession(options: SessionProbeOptions = {}): Promise<SessionProbe> {
  const { fetchFn = globalThis.fetch, path = OIDC_USERINFO_PATH, timeoutMs = SESSION_PROBE_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(path, {
      headers: { Accept: "application/json" }, credentials: "same-origin", redirect: "manual", signal: controller.signal,
    });
    return await probeFromResponse(res);
  } catch (err) {
    return unreachable(reasonFor(err, controller.signal));
  } finally {
    clearTimeout(timer);
  }
}
