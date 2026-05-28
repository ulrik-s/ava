"use client";

/**
 * `FirmaSettingsPanel` — låter användaren välja vilken repo AVA
 * ska läsa data från: demo, en privat GitHub-repo, eller en
 * self-hosted Cleura/Linux server.
 *
 * Visas via en "Byt firma"-knapp i `DemoBootstrap`-overlay:n. Spara
 * → reload sidan så ny config laddas.
 *
 * Sub-komponenter (alla exporterade för isolerad testning):
 *   - TierPicker         — tier-knapparna
 *   - AuthTokenSection   — token + Verifiera + OAuth + PAT-helper
 *   - IdentityFields     — namn + e-post
 *   - FooterButtons      — Spara / Avbryt / Demo / Logout
 *   - CorsProxyField     — CORS-proxy-config + test-knapp
 *   - ProxyTestButton    — OAuth-proxy test-knapp
 */

import { useEffect, useState } from "react";
import { type FirmaConfig, type FirmaTier, inferTier, saveFirmaConfig, resetToDemo } from "@/lib/client/firma/firma-config";
import { loadAuthSettings, saveAuthSettings } from "@/lib/client/auth/use-auth-mode";
import { loadOAuthConfig, saveOAuthConfig, isOAuthConfigured } from "@/lib/client/auth/oauth-config";
import { WebOAuthDeviceFlow } from "./web-oauth-device-flow";

interface Props {
  initial: FirmaConfig;
  onSaved: () => void;
  onCancel: () => void;
  /** Inline = ingen modal-wrapper, ingen Avbryt-knapp (för /settings-sidan). */
  inline?: boolean;
  /** Extra innehåll (FSA-väljare, sync-status) som renderas mellan
   *  konfig-fälten och Spara-knappen så knappen hamnar allra längst ner. */
  children?: React.ReactNode;
}

// eslint-disable-next-line complexity -- många tier-conditionals i JSX
export function FirmaSettingsPanel({ initial, onSaved, onCancel, inline = false, children }: Props) {
  const [tier, setTier] = useState<FirmaTier>(initial.tier);
  const [repo, setRepo] = useState(initial.repo);
  const [token, setToken] = useState(initial.token);
  const [orgId, setOrgId] = useState(initial.organizationId);
  const [name, setName] = useState(initial.authorName);
  const [email, setEmail] = useState(initial.authorEmail);
  const [corsProxy, setCorsProxy] = useState(initial.corsProxy ?? "");
  const [gitUsername, setGitUsername] = useState(initial.gitUsername ?? "");
  const [allowAnonymousRead, setAllowAnonymousRead] = useState<boolean>(
    () => loadAuthSettings().allowAnonymousRead,
  );
  // SSR-stabil initial — riktig config läses post-mount via useEffect
  const [oauth, setOauth] = useState<{ proxyUrl: string; clientId: string }>({ proxyUrl: "", clientId: "" });

  // Läs OAuth-config från localStorage efter hydration så vi undviker
  // mismatch mellan SSR-rendering (tom config) och client (sparad).
  useEffect(() => { queueMicrotask(() => setOauth(loadOAuthConfig())); }, []);

  const handleRepoChange = (v: string) => {
    setRepo(v);
    if (v) setTier(inferTier(v));
  };

  const save = () => {
    saveFirmaConfig({
      tier, repo, token,
      organizationId: orgId,
      authorName: name, authorEmail: email,
      corsProxy: corsProxy.trim() || undefined,
      gitUsername: gitUsername.trim() || undefined,
    });
    saveAuthSettings({ allowAnonymousRead });
    saveOAuthConfig(oauth);
    onSaved();
  };

  const logOut = () => {
    setToken("");
    saveFirmaConfig({
      tier, repo, token: "",
      organizationId: orgId,
      authorName: name, authorEmail: email,
      corsProxy: corsProxy.trim() || undefined,
      gitUsername: gitUsername.trim() || undefined,
    });
    onSaved();
  };

  const useDemo = () => { resetToDemo(); onSaved(); };

  const wrapperCls = inline
    ? ""
    : "bg-white rounded-lg border border-gray-200 p-6 max-w-2xl mx-auto";

  return (
    <div className={wrapperCls}>
      {!inline && <PanelHeader />}

      <div className={`${inline ? "" : "mt-4 "}space-y-3 text-sm`}>
        <TierPicker value={tier} onChange={setTier} />
        <RepoField tier={tier} value={repo} onChange={handleRepoChange} />

        {tier !== "demo" && (
          <AuthTokenSection
            tier={tier} token={token} onTokenChange={setToken}
            oauth={oauth} onOauthChange={setOauth}
            orgId={orgId}
          />
        )}

        <OrgIdField value={orgId} onChange={setOrgId} />
        <AnonymousReadToggle checked={allowAnonymousRead} onChange={setAllowAnonymousRead} />
        <IdentityFields name={name} email={email} onNameChange={setName} onEmailChange={setEmail} />

        {tier === "self-hosted" && (
          <GitUsernameField tier={tier} value={gitUsername} onChange={setGitUsername} authorEmail={email} />
        )}

        {tier !== "demo" && <CorsProxyField value={corsProxy} onChange={setCorsProxy} />}
      </div>

      {children}

      <FooterButtons
        inline={inline}
        canSave={!!repo}
        hasToken={!!token}
        onSave={save}
        onCancel={onCancel}
        onLogOut={logOut}
        onUseDemo={useDemo}
      />
    </div>
  );
}

// ─── Sub-komponenter ──────────────────────────────────────────────────────

function PanelHeader() {
  return (
    <>
      <h2 className="text-lg font-semibold text-gray-900">Välj firma / datakälla</h2>
      <p className="text-sm text-gray-600 mt-1">
        AVA är multi-tenant via git. Välj vilken repo som ska användas
        som data-källa.
      </p>
    </>
  );
}

const TIER_LABELS: Record<FirmaTier, string> = {
  "demo": "1. Demo (publik)",
  "github": "2. GitHub (privat)",
  "self-hosted": "3. Self-hosted (Cleura/Linux)",
};

export function TierPicker({ value, onChange }: { value: FirmaTier; onChange: (t: FirmaTier) => void }) {
  const tiers: FirmaTier[] = ["demo", "github", "self-hosted"];
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">Tier</label>
      <div className="flex gap-2">
        {tiers.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={`px-3 py-1.5 rounded text-xs ${
              value === t
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {TIER_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

const REPO_PLACEHOLDERS: Record<FirmaTier, string> = {
  "demo": "ulrik-s/ava-demo",
  "github": "user/repo eller https://github.com/user/repo.git",
  "self-hosted": "https://git.firma.se/data.git",
};

export function RepoField({ tier, value, onChange }: { tier: FirmaTier; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 mb-1 block">Repo</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={REPO_PLACEHOLDERS[tier]}
        className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
      />
    </label>
  );
}

function OrgIdField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 mb-1 block">Organisation ID i data:n</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="firma-x"
        className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
      />
    </label>
  );
}

function AnonymousReadToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 pt-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-xs text-gray-700">
        Tillåt anonym läsning (avmarkera = kräv inloggning för att se data)
      </span>
    </label>
  );
}

export function GitUsernameField({ tier, value, onChange, authorEmail }: {
  tier: FirmaTier;
  value: string;
  onChange: (v: string) => void;
  authorEmail: string;
}) {
  if (tier !== "self-hosted") return null;
  const fallback = authorEmail || "admin";
  return (
    <label className="block">
      <span className="text-xs text-gray-500 mb-1 block">
        Git-användarnamn (Basic-auth mot self-hosted nginx)
      </span>
      <input
        type="text" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Lämna tomt → använder "${fallback}"`}
        className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
      />
      <span className="text-[11px] text-gray-400 mt-1 block">
        nginx htpasswd-användaren — typiskt &quot;admin&quot; (bootstrap-PAT) eller en e-post
        (skapad med <code className="font-mono bg-gray-100 px-1 rounded">add-user.sh</code>).
        Tomt = härleds från e-post.
      </span>
    </label>
  );
}

export function IdentityFields(props: {
  name: string; email: string;
  onNameChange: (v: string) => void; onEmailChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="text-xs text-gray-500 mb-1 block">Ditt namn (för commits)</span>
        <input
          type="text" value={props.name}
          onChange={(e) => props.onNameChange(e.target.value)}
          placeholder="Anna Advokat"
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-xs text-gray-500 mb-1 block">Din e-post</span>
        <input
          type="email" value={props.email}
          onChange={(e) => props.onEmailChange(e.target.value)}
          placeholder="anna@firma.se"
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
      </label>
    </div>
  );
}

export function FooterButtons(props: {
  inline: boolean;
  canSave: boolean;
  hasToken: boolean;
  onSave: () => void;
  onCancel: () => void;
  onLogOut: () => void;
  onUseDemo: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-between">
      <div className="flex gap-3">
        <button type="button" onClick={props.onUseDemo} className="text-xs text-gray-500 hover:underline">
          Återställ till demo
        </button>
        {props.hasToken && (
          <button type="button" onClick={props.onLogOut} className="text-xs text-red-600 hover:underline">
            Logga ut (rensa token)
          </button>
        )}
      </div>
      <div className="flex gap-2">
        {!props.inline && (
          <button
            type="button"
            onClick={props.onCancel}
            className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Avbryt
          </button>
        )}
        <button
          type="button"
          onClick={props.onSave}
          disabled={!props.canSave}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
        >
          Spara
        </button>
      </div>
    </div>
  );
}

// ─── Auth-token-sektion ───────────────────────────────────────────────────

type TokenStatus = "untested" | "checking" | "valid" | "invalid";
export interface TokenValidationResult { status: Exclude<TokenStatus, "untested" | "checking">; msg: string }

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

export function AuthTokenSection(props: {
  tier: FirmaTier;
  token: string;
  onTokenChange: (v: string) => void;
  oauth: { proxyUrl: string; clientId: string };
  onOauthChange: (v: { proxyUrl: string; clientId: string }) => void;
  orgId: string;
}) {
  const [showOauth, setShowOauth] = useState(false);
  const [showOauthCfg, setShowOauthCfg] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>("untested");
  const [tokenStatusMsg, setTokenStatusMsg] = useState<string | null>(null);

  const openPatHelper = () => {
    const desc = encodeURIComponent(`AVA — ${props.orgId || "default"}`);
    const url = `https://github.com/settings/personal-access-tokens/new?description=${desc}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const runValidate = async () => {
    setTokenStatus("checking");
    setTokenStatusMsg(null);
    try {
      const result = await validateGithubToken({ token: props.token, tier: props.tier, repo: "" });
      setTokenStatus(result.status);
      setTokenStatusMsg(result.msg);
    } catch (e) {
      setTokenStatus("invalid");
      setTokenStatusMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <AuthTokenHeader
        tier={props.tier}
        oauth={props.oauth}
        showOauthCfg={showOauthCfg}
        onShowOauth={() => setShowOauth(true)}
        onToggleOauthCfg={() => setShowOauthCfg((v) => !v)}
        onOpenPatHelper={openPatHelper}
      />
      <div className="flex gap-2">
        <input
          type="password" value={props.token}
          onChange={(e) => {
            props.onTokenChange(e.target.value);
            setTokenStatus("untested");
            setTokenStatusMsg(null);
          }}
          placeholder={props.tier === "github" ? "github_pat_... eller ghp_..." : "auth-token för din git-server"}
          className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
        />
        {props.tier === "github" && (
          <button
            type="button"
            onClick={() => void runValidate()}
            disabled={!props.token || tokenStatus === "checking"}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
            title="Verifiera token mot api.github.com"
          >
            {tokenStatus === "checking" ? "Testar…" : "Verifiera"}
          </button>
        )}
      </div>
      {tokenStatusMsg && <TokenStatusMessage status={tokenStatus} msg={tokenStatusMsg} />}
      {showOauth && (
        <div className="mt-2">
          <WebOAuthDeviceFlow
            onComplete={(t) => { props.onTokenChange(t); setShowOauth(false); }}
            onCancel={() => setShowOauth(false)}
          />
        </div>
      )}
      {showOauthCfg && <OAuthConfigFields oauth={props.oauth} onChange={props.onOauthChange} />}
    </div>
  );
}

function AuthTokenHeader(props: {
  tier: FirmaTier;
  oauth: { proxyUrl: string; clientId: string };
  showOauthCfg: boolean;
  onShowOauth: () => void;
  onToggleOauthCfg: () => void;
  onOpenPatHelper: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs text-gray-500">
        Auth-token <em>(lagras i localStorage)</em>
      </span>
      {props.tier === "github" && (
        <div className="flex gap-3">
          {isOAuthConfigured(props.oauth) && (
            <button type="button" onClick={props.onShowOauth} className="text-xs text-blue-600 hover:underline">
              Logga in via GitHub
            </button>
          )}
          <button type="button" onClick={props.onOpenPatHelper} className="text-xs text-blue-600 hover:underline">
            Skapa PAT på GitHub →
          </button>
          <button type="button" onClick={props.onToggleOauthCfg} className="text-xs text-gray-500 hover:underline">
            {props.showOauthCfg ? "Dölj OAuth-config" : "OAuth-config"}
          </button>
        </div>
      )}
    </div>
  );
}

function TokenStatusMessage({ status, msg }: { status: TokenStatus; msg: string }) {
  const color = status === "valid" ? "text-green-700" : status === "invalid" ? "text-red-700" : "text-gray-600";
  return <p className={`mt-1 text-xs ${color}`}>{msg}</p>;
}

function OAuthConfigFields(props: {
  oauth: { proxyUrl: string; clientId: string };
  onChange: (v: { proxyUrl: string; clientId: string }) => void;
}) {
  return (
    <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-3 space-y-2">
      <p className="text-xs text-gray-700">
        För att aktivera &quot;Logga in via GitHub&quot; behövs en deployerad
        OAuth-proxy. Se{" "}
        <code className="bg-white px-1 rounded">scripts/oauth-proxy/README.md</code>.
      </p>
      <label className="block">
        <span className="text-[11px] text-gray-500 block mb-0.5">OAuth proxy URL</span>
        <input
          type="url" value={props.oauth.proxyUrl}
          onChange={(e) => props.onChange({ ...props.oauth, proxyUrl: e.target.value })}
          placeholder="https://ava-oauth-proxy.<account>.workers.dev"
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono"
        />
      </label>
      <label className="block">
        <span className="text-[11px] text-gray-500 block mb-0.5">OAuth Client ID</span>
        <input
          type="text" value={props.oauth.clientId}
          onChange={(e) => props.onChange({ ...props.oauth, clientId: e.target.value })}
          placeholder="Ov23li..."
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono"
        />
      </label>
      <ProxyTestButton url={props.oauth.proxyUrl} />
    </div>
  );
}

// ─── OAuth-proxy-test ─────────────────────────────────────────────────────

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

export function ProxyTestButton({ url }: { url: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProxyTestResult | null>(null);

  const test = async () => {
    setBusy(true);
    setResult(null);
    setResult(await testOAuthProxy(url));
    setBusy(false);
  };

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => void test()}
        disabled={busy || !url}
        className="text-xs px-2 py-1 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "Testar…" : "Testa proxy-anslutning"}
      </button>
      {result && (
        <p className={`text-[11px] mt-1 ${result.ok ? "text-green-700" : "text-red-700"}`}>
          {result.msg}
        </p>
      )}
    </div>
  );
}

// ─── CORS-proxy-fält ──────────────────────────────────────────────────────

const CORS_PROXY_PREFABS: Array<{ url: string; label: string; warning?: string }> = [
  {
    url: "",
    label: "cors.isomorphic-git.org (default)",
    warning: "Publik gratis-tjänst — instabil, gick ner senast.",
  },
  {
    url: "https://cors.proxy.aulneau.com",
    label: "cors.proxy.aulneau.com (community-driven)",
    warning: "Alternativ publik proxy.",
  },
];

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

export function CorsProxyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ProxyTestResult | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    setResult(await testCorsProxy(value));
    setTesting(false);
  };

  return (
    <div className="pt-2 border-t border-gray-100">
      <label className="block">
        <span className="text-xs text-gray-500 mb-1 block">
          CORS-proxy för git <em>(GitHub:s git-endpoints saknar CORS-headers)</em>
        </span>
        <div className="flex gap-2">
          <input
            type="url" value={value}
            onChange={(e) => { onChange(e.target.value); setResult(null); }}
            placeholder="https://cors.isomorphic-git.org (default om tomt)"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing}
            className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? "Testar…" : "Testa"}
          </button>
        </div>
        {result && (
          <p className={`mt-1 text-xs ${result.ok ? "text-green-700" : "text-red-700"}`}>
            {result.msg}
          </p>
        )}
      </label>
      <p className="text-[11px] text-gray-500 mt-2">
        <strong>För produktion:</strong> deploya en egen Cloudflare Worker
        (se <code>scripts/oauth-proxy/README.md</code>). Den kan användas både
        som git-CORS-proxy och OAuth-proxy.
      </p>
      <div className="text-[11px] text-gray-500 mt-1">
        Snabbval:{" "}
        {CORS_PROXY_PREFABS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.url)}
            className="text-blue-600 hover:underline mr-3"
            title={p.warning}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
