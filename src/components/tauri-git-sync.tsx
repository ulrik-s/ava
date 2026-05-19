"use client";

/**
 * `TauriGitSync` — git-sync-panel i Tauri-build:n.
 *
 * Funktioner:
 *   - Initial clone-wizard om sökväg saknas
 *   - Auto-pull vid mount + var 60:e sekund i bakgrunden
 *   - Live git-status via fs-watch
 *   - Per-fil status via expanderbar lista
 *   - Pull/Push/Settings
 *   - Token i OS-keychain
 *
 * Returnerar null utanför Tauri.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GitStatusEntry } from "@/lib/tauri/bridge";

interface Status { loading: boolean; entries: GitStatusEntry[]; error: string | null }

const PATH_KEY = "ava.localRepoPath";
const TOKEN_SECRET = "github-token";
const AUTO_PULL_INTERVAL_MS = 60_000;

export function TauriGitSync() {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<Status>({ loading: true, entries: [], error: null });
  const [token, setToken] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showFileList, setShowFileList] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const repoPathRef = useRef("");
  const tokenRef = useRef("");

  const refresh = useCallback(async (path: string) => {
    if (!path) { setStatus({ loading: false, entries: [], error: null }); return; }
    try {
      const bridge = await import("@/lib/tauri/bridge");
      const entries = await bridge.gitStatus(path);
      setStatus({ loading: false, entries, error: null });
    } catch (err) {
      setStatus({ loading: false, entries: [], error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const doPull = useCallback(async (silent = false): Promise<void> => {
    const path = repoPathRef.current;
    const tk = tokenRef.current;
    if (!path || !tk) return;
    try {
      const bridge = await import("@/lib/tauri/bridge");
      const r = await bridge.gitPull(path, tk);
      if (!silent) {
        const label = r.kind === "up-to-date" ? "redan synkad"
          : r.kind === "fast-forward" ? `uppdaterad till ${r.newHead?.slice(0, 7)}`
          : "merge behövs (lös manuellt)";
        setLastResult(`✓ Pull: ${label}`);
      }
      await refresh(path);
    } catch (err) {
      if (!silent) {
        setLastResult(`✗ Pull: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [refresh]);

  // Mount: detektera Tauri, läs settings, starta fs-watch + auto-pull
  useEffect(() => {
    let watcherToken: number | null = null;
    let unsub: (() => void) | null = null;
    let pullTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      const bridge = await import("@/lib/tauri/bridge");
      if (!bridge.isTauri()) return;
      setAvailable(true);

      const savedPath = localStorage.getItem(PATH_KEY) ?? "";
      let savedToken = "";
      try {
        savedToken = (await bridge.secretGet(TOKEN_SECRET)) ?? "";
        const legacy = localStorage.getItem("ava.githubToken");
        if (!savedToken && legacy) {
          await bridge.secretSet(TOKEN_SECRET, legacy);
          localStorage.removeItem("ava.githubToken");
          savedToken = legacy;
        }
      } catch (err) {
        console.warn("[tauri-git-sync] keychain-läsning misslyckades:", err);
      }
      if (cancelled) return;
      setRepoPath(savedPath);
      setToken(savedToken);
      repoPathRef.current = savedPath;
      tokenRef.current = savedToken;
      await refresh(savedPath);

      if (savedPath) {
        try {
          watcherToken = await bridge.watchRepoStart(savedPath);
          unsub = await bridge.onRepoChange(() => { void refresh(savedPath); });
        } catch (err) {
          console.warn("[tauri-git-sync] fs-watch kunde inte startas:", err);
        }
        // Auto-pull vid mount + var 60:e sekund
        if (savedToken) {
          void doPull(true);
          pullTimer = setInterval(() => { void doPull(true); }, AUTO_PULL_INTERVAL_MS);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
      if (pullTimer) clearInterval(pullTimer);
      if (watcherToken !== null) {
        void import("@/lib/tauri/bridge").then((b) => b.watchRepoStop(watcherToken!));
      }
    };
  }, [refresh, doPull]);

  if (!available) return null;

  const saveSettings = async () => {
    const bridge = await import("@/lib/tauri/bridge");
    localStorage.setItem(PATH_KEY, repoPath);
    try {
      if (token) await bridge.secretSet(TOKEN_SECRET, token);
      else await bridge.secretDelete(TOKEN_SECRET);
    } catch (err) {
      setLastResult(`✗ Kunde inte spara token: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    repoPathRef.current = repoPath;
    tokenRef.current = token;
    setShowSettings(false);
    void refresh(repoPath);
  };

  const onPullClick = async () => {
    setBusy(true);
    setLastResult(null);
    await doPull(false);
    setBusy(false);
  };

  const commitAndPush = async () => {
    if (!repoPath || !token) { setShowSettings(true); return; }
    setBusy(true);
    setLastResult(null);
    try {
      const bridge = await import("@/lib/tauri/bridge");
      const n = status.entries.length;
      const msg = `AVA: ${n} ändring${n === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`;
      const commit = await bridge.gitCommitChanges(repoPath, msg);
      await bridge.gitPush(repoPath, token);
      setLastResult(`✓ Pushad: ${commit.oid.slice(0, 7)}`);
      await refresh(repoPath);
    } catch (err) {
      setLastResult(`✗ Push: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // Visa clone-wizard om repo-sökväg saknas
  if (!repoPath && !showSettings) {
    return (
      <CloneWizard
        onSettings={() => setShowSettings(true)}
        onCloneDone={(path, tk) => {
          setRepoPath(path);
          setToken(tk);
          repoPathRef.current = path;
          tokenRef.current = tk;
          localStorage.setItem(PATH_KEY, path);
          void import("@/lib/tauri/bridge").then((b) => b.secretSet(TOKEN_SECRET, tk));
          void refresh(path);
        }}
      />
    );
  }

  const changes = status.entries.length;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Synka mot GitHub</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {status.loading ? "Kollar status…"
              : status.error ? `Status-fel: ${status.error}`
              : changes === 0 ? "Inga osparade ändringar"
              : (
                <button
                  type="button"
                  onClick={() => setShowFileList((v) => !v)}
                  className="text-blue-600 hover:underline"
                >
                  {changes} osparad{changes === 1 ? "" : "e"} ändring{changes === 1 ? "" : "ar"} {showFileList ? "▴" : "▾"}
                </button>
              )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="text-xs text-gray-500 hover:text-blue-600 hover:underline"
          >
            Inställningar
          </button>
          <button
            type="button"
            onClick={() => void onPullClick()}
            disabled={busy}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            ↓ Pull
          </button>
          <button
            type="button"
            onClick={() => void commitAndPush()}
            disabled={busy || changes === 0}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {busy ? "Arbetar…" : "↑ Spara & pusha"}
          </button>
        </div>
      </div>

      {lastResult && <p className="mt-2 text-xs text-gray-700">{lastResult}</p>}

      {showFileList && changes > 0 && (
        <ul className="mt-3 border-t border-gray-100 pt-3 text-xs font-mono space-y-1 max-h-48 overflow-y-auto">
          {status.entries.map((e) => (
            <li key={e.path} className="flex items-center gap-2">
              <StatusBadge status={e.status} />
              <span className="text-gray-700 truncate">{e.path}</span>
            </li>
          ))}
        </ul>
      )}

      {showSettings && (
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-3">
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">Lokal sökväg till klonat repo</span>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="/Users/du/ava-data"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">
              GitHub Personal Access Token <em>(lagras i OS-keychain)</em>
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={() => void saveSettings()}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Spara
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    modified: "bg-amber-50 text-amber-700",
    added: "bg-green-50 text-green-700",
    deleted: "bg-red-50 text-red-700",
    renamed: "bg-purple-50 text-purple-700",
    untracked: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

interface CloneWizardProps {
  onSettings: () => void;
  onCloneDone: (path: string, token: string) => void;
}

function CloneWizard({ onSettings, onCloneDone }: CloneWizardProps) {
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doClone = async () => {
    setBusy(true);
    setError(null);
    try {
      const bridge = await import("@/lib/tauri/bridge");
      await bridge.gitClone(url, path, token || undefined);
      onCloneDone(path, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <h3 className="text-sm font-semibold text-blue-900">Klona ditt firms repo</h3>
      <p className="text-xs text-blue-800 mt-0.5">
        Första gången du kör appen behöver vi ladda ner en lokal kopia
        av firmans data-repo. Du kan också{" "}
        <button type="button" onClick={onSettings} className="underline hover:text-blue-600">
          ange en redan klonad sökväg
        </button>.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3">
        <label className="block">
          <span className="text-xs text-gray-700 mb-1 block">GitHub-repo (HTTPS-URL)</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/<firma>/<repo>.git"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-700 mb-1 block">Lokal mapp att klona till (måste vara tom)</span>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/du/ava-data"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-700 mb-1 block">
            GitHub Personal Access Token <em>(för privata repos / push)</em>
          </span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
          />
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-red-700">✗ {error}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => void doClone()}
          disabled={busy || !url || !path}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {busy ? "Klonar…" : "Klona"}
        </button>
      </div>
    </div>
  );
}
