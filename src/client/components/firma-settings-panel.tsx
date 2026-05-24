"use client";

/**
 * `FirmaSettingsPanel` — låter användaren välja vilken repo AVA
 * ska läsa data från: demo, en privat GitHub-repo, eller en
 * self-hosted Cleura/Linux server.
 *
 * Visas via en "Byt firma"-knapp i `DemoBootstrap`-overlay:n. Spara
 * → reload sidan så ny config laddas.
 */

import { useEffect, useState } from "react";
import { type FirmaConfig, type FirmaTier, inferTier, saveFirmaConfig, resetToDemo } from "@/client/lib/firma/firma-config";
import { loadAuthSettings, saveAuthSettings } from "@/client/lib/auth/use-auth-mode";
import { loadOAuthConfig, saveOAuthConfig, isOAuthConfigured } from "@/client/lib/auth/oauth-config";
import { WebOAuthDeviceFlow } from "./web-oauth-device-flow";

interface Props {
  initial: FirmaConfig;
  onSaved: () => void;
  onCancel: () => void;
  /** Inline = ingen modal-wrapper, ingen Avbryt-knapp (för /settings-sidan). */
  inline?: boolean;
}

export function FirmaSettingsPanel({ initial, onSaved, onCancel, inline = false }: Props) {
  const [tier, setTier] = useState<FirmaTier>(initial.tier);
  const [repo, setRepo] = useState(initial.repo);
  const [token, setToken] = useState(initial.token);
  const [orgId, setOrgId] = useState(initial.organizationId);
  const [name, setName] = useState(initial.authorName);
  const [email, setEmail] = useState(initial.authorEmail);
  const [corsProxy, setCorsProxy] = useState(initial.corsProxy ?? "");
  const [allowAnonymousRead, setAllowAnonymousRead] = useState<boolean>(
    () => loadAuthSettings().allowAnonymousRead,
  );
  // SSR-stabil initial — riktig config läses post-mount via useEffect
  const [oauth, setOauth] = useState<{ proxyUrl: string; clientId: string }>({ proxyUrl: "", clientId: "" });
  const [showOauth, setShowOauth] = useState(false);
  const [showOauthCfg, setShowOauthCfg] = useState(false);

  // Läs OAuth-config från localStorage efter hydration så vi undviker
  // mismatch mellan SSR-rendering (tom config) och client (sparad).
  useEffect(() => { queueMicrotask(() => setOauth(loadOAuthConfig())); }, []);

  const handleRepoChange = (v: string) => {
    setRepo(v);
    // Autoinferera tier för bekvämlighet
    if (v) setTier(inferTier(v));
  };

  const save = () => {
    saveFirmaConfig({
      tier, repo, token,
      organizationId: orgId,
      authorName: name, authorEmail: email,
      corsProxy: corsProxy.trim() || undefined,
    });
    saveAuthSettings({ allowAnonymousRead });
    saveOAuthConfig(oauth);
    onSaved();
  };

  const openPatHelper = () => {
    // Fine-grained PAT — modernare än classic, kan låsas till specifika
    // repos. URL-params för fine-grained är begränsade (GitHub fyller
    // inte i target_repo automatiskt) men vi pre-fyller beskrivningen.
    const desc = encodeURIComponent(`AVA — ${orgId || "default"}`);
    const url = `https://github.com/settings/personal-access-tokens/new?description=${desc}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const [tokenStatus, setTokenStatus] = useState<"untested" | "checking" | "valid" | "invalid">("untested");
  const [tokenStatusMsg, setTokenStatusMsg] = useState<string | null>(null);

  const validateToken = async () => {
    if (!token) {
      setTokenStatus("invalid");
      setTokenStatusMsg("Tom token");
      return;
    }
    setTokenStatus("checking");
    setTokenStatusMsg(null);
    try {
      // Verifiera via /user (CORS-enabled, fungerar utan proxy)
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        setTokenStatus("invalid");
        setTokenStatusMsg(`GitHub avvisade: ${res.status} ${res.statusText}`);
        return;
      }
      const user = await res.json() as { login: string };
      // Verifiera repo-åtkomst om repo angetts
      if (repo && tier === "github") {
        const parsed = repo.match(/^([^/]+)\/([^/.]+)/);
        if (parsed) {
          const r = await fetch(`https://api.github.com/repos/${parsed[1]}/${parsed[2]}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
          });
          if (!r.ok) {
            setTokenStatus("invalid");
            setTokenStatusMsg(`Ingen åtkomst till ${parsed[1]}/${parsed[2]}: ${r.status}`);
            return;
          }
          const repoInfo = await r.json() as { permissions?: { push?: boolean } };
          const canPush = repoInfo.permissions?.push === true;
          setTokenStatus("valid");
          setTokenStatusMsg(`✓ @${user.login} — ${canPush ? "kan pusha" : "endast läsning"}`);
          return;
        }
      }
      setTokenStatus("valid");
      setTokenStatusMsg(`✓ @${user.login}`);
    } catch (e) {
      setTokenStatus("invalid");
      setTokenStatusMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const logOut = () => {
    setToken("");
    saveFirmaConfig({
      tier, repo, token: "",
      organizationId: orgId,
      authorName: name, authorEmail: email,
      corsProxy: corsProxy.trim() || undefined,
    });
    onSaved();
  };

  const useDemo = () => {
    resetToDemo();
    onSaved();
  };

  const Wrapper = inline ? "div" : "div";
  const wrapperCls = inline
    ? ""
    : "bg-white rounded-lg border border-gray-200 p-6 max-w-2xl mx-auto";

  return (
    <Wrapper className={wrapperCls}>
      {!inline && (
        <>
          <h2 className="text-lg font-semibold text-gray-900">Välj firma / datakälla</h2>
          <p className="text-sm text-gray-600 mt-1">
            AVA är multi-tenant via git. Välj vilken repo som ska användas
            som data-källa.
          </p>
        </>
      )}

      <div className={`${inline ? "" : "mt-4 "}space-y-3 text-sm`}>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Tier</label>
          <div className="flex gap-2">
            {(["demo", "github", "self-hosted"] as FirmaTier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`px-3 py-1.5 rounded text-xs ${
                  tier === t
                    ? "bg-blue-600 text-white"
                    : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t === "demo" ? "1. Demo (publik)"
                  : t === "github" ? "2. GitHub (privat)"
                  : "3. Self-hosted (Cleura/Linux)"}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">Repo</span>
          <input
            type="text"
            value={repo}
            onChange={(e) => handleRepoChange(e.target.value)}
            placeholder={
              tier === "demo" ? "ulrik-s/ava-demo"
              : tier === "github" ? "user/repo eller https://github.com/user/repo.git"
              : "https://git.firma.se/data.git"
            }
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
          />
        </label>

        {tier !== "demo" && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">
                Auth-token <em>(lagras i localStorage)</em>
              </span>
              {tier === "github" && (
                <div className="flex gap-3">
                  {isOAuthConfigured(oauth) && (
                    <button
                      type="button"
                      onClick={() => setShowOauth(true)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Logga in via GitHub
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openPatHelper}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Skapa PAT på GitHub →
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOauthCfg((v) => !v)}
                    className="text-xs text-gray-500 hover:underline"
                  >
                    {showOauthCfg ? "Dölj OAuth-config" : "OAuth-config"}
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={token}
                onChange={(e) => { setToken(e.target.value); setTokenStatus("untested"); setTokenStatusMsg(null); }}
                placeholder={tier === "github" ? "github_pat_... eller ghp_..." : "auth-token för din git-server"}
                className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
              />
              {tier === "github" && (
                <button
                  type="button"
                  onClick={() => void validateToken()}
                  disabled={!token || tokenStatus === "checking"}
                  className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                  title="Verifiera token mot api.github.com"
                >
                  {tokenStatus === "checking" ? "Testar…" : "Verifiera"}
                </button>
              )}
            </div>
            {tokenStatusMsg && (
              <p className={`mt-1 text-xs ${tokenStatus === "valid" ? "text-green-700" : tokenStatus === "invalid" ? "text-red-700" : "text-gray-600"}`}>
                {tokenStatusMsg}
              </p>
            )}
            {showOauth && (
              <div className="mt-2">
                <WebOAuthDeviceFlow
                  onComplete={(t) => { setToken(t); setShowOauth(false); }}
                  onCancel={() => setShowOauth(false)}
                />
              </div>
            )}
            {showOauthCfg && (
              <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-3 space-y-2">
                <p className="text-xs text-gray-700">
                  För att aktivera &quot;Logga in via GitHub&quot; behövs en deployerad
                  OAuth-proxy. Se{" "}
                  <code className="bg-white px-1 rounded">scripts/oauth-proxy/README.md</code>.
                </p>
                <label className="block">
                  <span className="text-[11px] text-gray-500 block mb-0.5">OAuth proxy URL</span>
                  <input
                    type="url"
                    value={oauth.proxyUrl}
                    onChange={(e) => setOauth({ ...oauth, proxyUrl: e.target.value })}
                    placeholder="https://ava-oauth-proxy.<account>.workers.dev"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-500 block mb-0.5">OAuth Client ID</span>
                  <input
                    type="text"
                    value={oauth.clientId}
                    onChange={(e) => setOauth({ ...oauth, clientId: e.target.value })}
                    placeholder="Ov23li..."
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono"
                  />
                </label>
                <ProxyTestButton url={oauth.proxyUrl} />
              </div>
            )}
          </div>
        )}

        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">Organisation ID i data:n</span>
          <input
            type="text"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="firma-x"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
          />
        </label>

        <label className="flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            checked={allowAnonymousRead}
            onChange={(e) => setAllowAnonymousRead(e.target.checked)}
          />
          <span className="text-xs text-gray-700">
            Tillåt anonym läsning (avmarkera = kräv inloggning för att se data)
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">Ditt namn (för commits)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Anna Advokat"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">Din e-post</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="anna@firma.se"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>
        </div>

        {tier !== "demo" && (
          <CorsProxyField value={corsProxy} onChange={setCorsProxy} />
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={useDemo}
            className="text-xs text-gray-500 hover:underline"
          >
              Återställ till demo
          </button>
          {token && (
            <button
              type="button"
              onClick={logOut}
              className="text-xs text-red-600 hover:underline"
            >
              Logga ut (rensa token)
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {!inline && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
            >
              Avbryt
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!repo}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
          >
            Spara & ladda om
          </button>
        </div>
      </div>
    </Wrapper>
  );
}

function ProxyTestButton({ url }: { url: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const test = async () => {
    if (!url) { setResult({ ok: false, msg: "Saknar URL" }); return; }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/device/code`, { method: "POST" });
      if (!res.ok) {
        setResult({ ok: false, msg: `Proxy svarade ${res.status} ${res.statusText}` });
        return;
      }
      const data = await res.json() as { user_code?: string; error?: string };
      if (data.user_code) setResult({ ok: true, msg: `✓ Proxy svarar (test-kod: ${data.user_code})` });
      else setResult({ ok: false, msg: `Oväntat svar: ${data.error ?? JSON.stringify(data).slice(0, 80)}` });
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
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

function CorsProxyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const effectiveUrl = value || "https://cors.isomorphic-git.org";

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      // Ping en känd GitHub-endpoint genom proxy:n
      const url = `${effectiveUrl.replace(/\/+$/, "")}/github.com/ulrik-s/ava-demo/info/refs?service=git-upload-pack`;
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        setResult({ ok: true, msg: `✓ Proxy svarar (${res.status})` });
      } else {
        setResult({ ok: false, msg: `Proxy svarade ${res.status} ${res.statusText}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ ok: false, msg: `✗ ${msg}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="pt-2 border-t border-gray-100">
      <label className="block">
        <span className="text-xs text-gray-500 mb-1 block">
          CORS-proxy för git <em>(GitHub:s git-endpoints saknar CORS-headers)</em>
        </span>
        <div className="flex gap-2">
          <input
            type="url"
            value={value}
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
