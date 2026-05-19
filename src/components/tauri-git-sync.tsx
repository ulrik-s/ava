"use client";

/**
 * `TauriGitSync` — git-sync-panel i Tauri-build:n.
 *
 * Funktioner:
 *   - Visar git-status (osparade ändringar) — live via fs-watch
 *   - Pull/Push via knappar
 *   - Repo-sökväg och GitHub PAT — PAT lagras i OS-keychain via
 *     `secret_get/secret_set/secret_delete` (Rust `keyring`).
 *   - localStorage-fallback för migration; städas vid första
 *     keychain-save.
 *
 * Returnerar null utanför Tauri.
 */

import { useCallback, useEffect, useState } from "react";

interface Status { loading: boolean; changes: number; error: string | null }

const PATH_KEY = "ava.localRepoPath";
const TOKEN_SECRET = "github-token";

export function TauriGitSync() {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<Status>({ loading: true, changes: 0, error: null });
  const [token, setToken] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const refresh = useCallback(async (path: string) => {
    if (!path) { setStatus({ loading: false, changes: 0, error: null }); return; }
    try {
      const bridge = await import("@/lib/tauri/bridge");
      const entries = await bridge.gitStatus(path);
      setStatus({ loading: false, changes: entries.length, error: null });
    } catch (err) {
      setStatus({ loading: false, changes: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  // Init: detektera Tauri, läs settings + token från keychain, starta fs-watch
  useEffect(() => {
    let watcherToken: number | null = null;
    let unsub: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const bridge = await import("@/lib/tauri/bridge");
      if (!bridge.isTauri()) return;
      setAvailable(true);

      const savedPath = localStorage.getItem(PATH_KEY) ?? "";
      let savedToken = "";
      try {
        savedToken = (await bridge.secretGet(TOKEN_SECRET)) ?? "";
        // Migrera ev. legacy-token från localStorage in i keychain
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
      await refresh(savedPath);

      if (savedPath) {
        try {
          watcherToken = await bridge.watchRepoStart(savedPath);
          unsub = await bridge.onRepoChange(() => {
            // Debounce inte här — Rust-eventen är redan paketerade per
            // batch och vi vill ha snabb feedback efter spara-i-editor.
            void refresh(savedPath);
          });
        } catch (err) {
          console.warn("[tauri-git-sync] fs-watch kunde inte startas:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
      if (watcherToken !== null) {
        void import("@/lib/tauri/bridge").then((b) => b.watchRepoStop(watcherToken!));
      }
    };
  }, [refresh]);

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
    setShowSettings(false);
    void refresh(repoPath);
  };

  const doPull = async () => {
    if (!repoPath || !token) { setShowSettings(true); return; }
    setBusy(true);
    setLastResult(null);
    try {
      const bridge = await import("@/lib/tauri/bridge");
      const r = await bridge.gitPull(repoPath, token);
      const label = r.kind === "up-to-date" ? "redan synkad"
        : r.kind === "fast-forward" ? `uppdaterad till ${r.newHead?.slice(0, 7)}`
        : "merge behövs (lös manuellt)";
      setLastResult(`✓ Pull: ${label}`);
      await refresh(repoPath);
    } catch (err) {
      setLastResult(`✗ Pull: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const commitAndPush = async () => {
    if (!repoPath || !token) { setShowSettings(true); return; }
    setBusy(true);
    setLastResult(null);
    try {
      const bridge = await import("@/lib/tauri/bridge");
      const msg = `AVA: ${status.changes} ändring${status.changes === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`;
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

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Synka mot GitHub</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {status.loading
              ? "Kollar status…"
              : status.error
              ? `Status-fel: ${status.error}`
              : status.changes === 0
              ? "Inga osparade ändringar"
              : `${status.changes} osparad${status.changes === 1 ? "" : "e"} ändring${status.changes === 1 ? "" : "ar"} redo att pushas`}
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
            onClick={doPull}
            disabled={busy}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            ↓ Pull
          </button>
          <button
            type="button"
            onClick={commitAndPush}
            disabled={busy || status.changes === 0}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {busy ? "Arbetar…" : "↑ Spara & pusha"}
          </button>
        </div>
      </div>
      {lastResult && (
        <p className="mt-2 text-xs text-gray-700">{lastResult}</p>
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
