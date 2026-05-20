"use client";

/**
 * `FirmaSettingsPanel` — låter användaren välja vilken repo AVA
 * ska läsa data från: demo, en privat GitHub-repo, eller en
 * self-hosted Cleura/Linux server.
 *
 * Visas via en "Byt firma"-knapp i `DemoBootstrap`-overlay:n. Spara
 * → reload sidan så ny config laddas.
 */

import { useState } from "react";
import { type FirmaConfig, type FirmaTier, inferTier, saveFirmaConfig, resetToDemo } from "@/lib/firma/firma-config";
import { loadAuthSettings, saveAuthSettings } from "@/lib/auth/use-auth-mode";

interface Props {
  initial: FirmaConfig;
  onSaved: () => void;
  onCancel: () => void;
}

export function FirmaSettingsPanel({ initial, onSaved, onCancel }: Props) {
  const [tier, setTier] = useState<FirmaTier>(initial.tier);
  const [repo, setRepo] = useState(initial.repo);
  const [token, setToken] = useState(initial.token);
  const [orgId, setOrgId] = useState(initial.organizationId);
  const [name, setName] = useState(initial.authorName);
  const [email, setEmail] = useState(initial.authorEmail);
  const [allowAnonymousRead, setAllowAnonymousRead] = useState<boolean>(
    () => loadAuthSettings().allowAnonymousRead,
  );

  const handleRepoChange = (v: string) => {
    setRepo(v);
    // Autoinferera tier för bekvämlighet
    if (v) setTier(inferTier(v));
  };

  const save = () => {
    saveFirmaConfig({ tier, repo, token, organizationId: orgId, authorName: name, authorEmail: email });
    saveAuthSettings({ allowAnonymousRead });
    onSaved();
  };

  const logOut = () => {
    setToken("");
    saveFirmaConfig({ tier, repo, token: "", organizationId: orgId, authorName: name, authorEmail: email });
    onSaved();
  };

  const useDemo = () => {
    resetToDemo();
    onSaved();
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold text-gray-900">Välj firma / datakälla</h2>
      <p className="text-sm text-gray-600 mt-1">
        AVA är multi-tenant via git. Välj vilken repo som ska användas
        som data-källa.
      </p>

      <div className="mt-4 space-y-3 text-sm">
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
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">
              Auth-token <em>(lagras i localStorage)</em>
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={tier === "github" ? "ghp_..." : "auth-token för din git-server"}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
            />
          </label>
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
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Avbryt
          </button>
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
    </div>
  );
}
