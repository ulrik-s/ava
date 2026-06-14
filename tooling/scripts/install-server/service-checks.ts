/**
 * Tjänste-kommunikationskontroller för install-server (#323, uppföljning #232/#258).
 *
 * Medan `preflight.ts` kollar LOKALA förutsättningar FÖRE start (docker finns,
 * web-porten ledig), verifierar detta att den körande installationen faktiskt
 * NÅR och får rätt svar från de olika tjänsterna: IdP:n (OIDC-discovery),
 * web-containern och git smart-HTTP. `fetch` injiceras → rent testbart utan
 * riktiga tjänster.
 */

import type { ServerInstallConfig } from "./core";

export interface ServiceCheck {
  name: string;
  ok: boolean;
  detail: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const trimSlash = (s: string): string => s.replace(/\/+$/, "");

/**
 * IdP-koll: hämta OIDC-discovery-dokumentet och kräv ett
 * `authorization_endpoint`. Detta är "kommunicerar vi med IdP:n?"-testet.
 */
export async function checkOidcIssuer(issuerUrl: string, fetchFn: FetchLike): Promise<ServiceCheck> {
  const url = `${trimSlash(issuerUrl)}/.well-known/openid-configuration`;
  const name = "OIDC issuer";
  try {
    const res = await fetchFn(url);
    if (!res.ok) return { name, ok: false, detail: `${url} → HTTP ${res.status}` };
    const doc = (await res.json()) as { authorization_endpoint?: string };
    if (!doc.authorization_endpoint) {
      return { name, ok: false, detail: `discovery saknar authorization_endpoint (${url})` };
    }
    return { name, ok: true, detail: `discovery OK (${url})` };
  } catch (e) {
    return { name, ok: false, detail: `${url} onåbar: ${errText(e)}` };
  }
}

/** Web-koll: `/ava/` svarar 200 och innehåller appens markör. */
export async function checkWeb(baseUrl: string, fetchFn: FetchLike): Promise<ServiceCheck> {
  const url = `${trimSlash(baseUrl)}/ava/`;
  const name = "web";
  try {
    const res = await fetchFn(url);
    const body = await res.text();
    if (res.ok && body.includes("AVA")) return { name, ok: true, detail: `${url} → 200 (AVA)` };
    return { name, ok: false, detail: `${url} → HTTP ${res.status}${res.ok ? " men saknar 'AVA'-markör (stale out/?)" : ""}` };
  } catch (e) {
    return { name, ok: false, detail: `${url} onåbar: ${errText(e)}` };
  }
}

/**
 * Git smart-HTTP-koll: `info/refs?service=git-upload-pack`. 200 = öppet,
 * 401 = auth krävs (men nåbar — förväntat bakom htpasswd/oidc). Övrigt = fel.
 */
export async function checkGitHttp(baseUrl: string, repoPath: string, fetchFn: FetchLike): Promise<ServiceCheck> {
  const repo = repoPath.replace(/^\/+/, "");
  const url = `${trimSlash(baseUrl)}/git/${repo}/info/refs?service=git-upload-pack`;
  const name = "git smart-HTTP";
  try {
    const res = await fetchFn(url);
    const reachable = res.status === 200 || res.status === 401;
    return { name, ok: reachable, detail: `${url} → HTTP ${res.status}${res.status === 401 ? " (auth krävs — nåbar)" : ""}` };
  } catch (e) {
    return { name, ok: false, detail: `${url} onåbar: ${errText(e)}` };
  }
}

export interface ServiceCheckOpts {
  /** Origin för web + git (t.ex. http://localhost:8080). */
  baseUrl: string;
  /** Git-repo-path under /git/ (default firma.git). */
  repoPath?: string;
  fetchFn?: FetchLike;
}

/** Kör alla relevanta tjänste-kontroller för den givna installationen. */
export async function checkServices(cfg: ServerInstallConfig, opts: ServiceCheckOpts): Promise<ServiceCheck[]> {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as FetchLike);
  const checks: Promise<ServiceCheck>[] = [
    checkWeb(opts.baseUrl, fetchFn),
    checkGitHttp(opts.baseUrl, opts.repoPath ?? "firma.git", fetchFn),
  ];
  if (cfg.authMode === "oidc" && cfg.oidc) {
    checks.push(checkOidcIssuer(cfg.oidc.issuerUrl, fetchFn));
  }
  return Promise.all(checks);
}

/** Sammanställ till {ok, rader} för CLI-rapport. */
export function summarizeServiceChecks(checks: readonly ServiceCheck[]): { ok: boolean; lines: string[] } {
  const lines = checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  return { ok: checks.every((c) => c.ok), lines };
}
