/**
 * `firma-settings-net` — nätverks-/validerings-helpers för `FirmaSettingsPanel`
 * (#62): GitHub-token-/repo-validering + OAuth-/CORS-proxy-tester. Pure med
 * injektbar `fetchFn` (testas isolerat), utbrutna ur den React-tunga panelen
 * (SRP). Re-exporteras från `firma-settings-panel` för bakåtkompatibilitet.
 */
import type { FirmaTier } from "@/lib/client/firma/firma-config";

export interface TokenValidationResult { status: "valid" | "invalid"; msg: string }

/**
 * Pure validator — testas separat utan komponent. `fetchFn` injicerbar
 * för tester (default = globalThis.fetch).
 */
export async function validateGithubToken(
  args: { token: string; tier: FirmaTier; repo: string; fetchFn?: typeof fetch },
): Promise<TokenValidationResult> {
  const fetchFn = args.fetchFn ?? globalThis.fetch.bind(globalThis);
  if (!args.token) return { status: "invalid", msg: "Tom token" };
  const res = await fetchFn("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${args.token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return { status: "invalid", msg: `GitHub avvisade: ${res.status} ${res.statusText}` };
  const user = await res.json() as { login: string };
  if (!args.repo || args.tier !== "github") return { status: "valid", msg: `✓ @${user.login}` };
  return validateRepoAccess({ token: args.token, repo: args.repo, login: user.login, fetchFn });
}

async function validateRepoAccess(args: {
  token: string; repo: string; login: string; fetchFn: typeof fetch;
}): Promise<TokenValidationResult> {
  const parsed = args.repo.match(/^([^/]+)\/([^/.]+)/);
  if (!parsed) return { status: "valid", msg: `✓ @${args.login}` };
  const r = await args.fetchFn(`https://api.github.com/repos/${parsed[1]}/${parsed[2]}`, {
    headers: { Authorization: `Bearer ${args.token}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return { status: "invalid", msg: `Ingen åtkomst till ${parsed[1]}/${parsed[2]}: ${r.status}` };
  const repoInfo = await r.json() as { permissions?: { push?: boolean } };
  const canPush = repoInfo.permissions?.push === true;
  return { status: "valid", msg: `✓ @${args.login} — ${canPush ? "kan pusha" : "endast läsning"}` };
}

export interface ProxyTestResult { ok: boolean; msg: string }

/** Pure tester av OAuth-proxy:n. `fetchFn` injicerbar för tester. */
export async function testOAuthProxy(url: string, fetchFn?: typeof fetch): Promise<ProxyTestResult> {
  if (!url) return { ok: false, msg: "Saknar URL" };
  const fn = fetchFn ?? globalThis.fetch.bind(globalThis);
  try {
    const res = await fn(`${url.replace(/\/+$/, "")}/device/code`, { method: "POST" });
    if (!res.ok) return { ok: false, msg: `Proxy svarade ${res.status} ${res.statusText}` };
    const data = await res.json() as { user_code?: string; error?: string };
    if (data.user_code) return { ok: true, msg: `✓ Proxy svarar (test-kod: ${data.user_code})` };
    return { ok: false, msg: `Oväntat svar: ${data.error ?? JSON.stringify(data).slice(0, 80)}` };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/** Pure tester av CORS-proxy mot ava-demo-repots refs-endpoint. */
export async function testCorsProxy(url: string, fetchFn?: typeof fetch): Promise<ProxyTestResult> {
  const fn = fetchFn ?? globalThis.fetch.bind(globalThis);
  const effective = url || "https://cors.isomorphic-git.org";
  try {
    const target = `${effective.replace(/\/+$/, "")}/github.com/ulrik-s/ava-demo/info/refs?service=git-upload-pack`;
    const res = await fn(target, { method: "GET" });
    if (res.ok) return { ok: true, msg: `✓ Proxy svarar (${res.status})` };
    return { ok: false, msg: `Proxy svarade ${res.status} ${res.statusText}` };
  } catch (e) {
    return { ok: false, msg: `✗ ${e instanceof Error ? e.message : String(e)}` };
  }
}
