"use client";

/**
 * `TauriGitSync` — visar git-status i Tauri-build:n och låter
 * användaren committa + pusha ändringar (efter PDF-redigering).
 *
 * Renderar `null` utanför Tauri.
 *
 * Designval:
 *   - GitHub PAT lagras i `localStorage` för v1 (snabbt). Senare bör
 *     vi använda Tauri:s keychain (`tauri-plugin-stronghold` /
 *     `tauri-plugin-keychain`).
 *   - Repo-sökvägen kommer från en env-var
 *     `NEXT_PUBLIC_LOCAL_REPO_PATH` eller från `localStorage`.
 */

import { useCallback, useEffect, useState } from "react";

interface Status {
  loading: boolean;
  changes: number;
  error: string | null;
}

export function TauriGitSync() {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<Status>({ loading: true, changes: 0, error: null });
  const [token, setToken] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [pushing, setPushing] = useState(false);
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

  useEffect(() => {
    (async () => {
      const bridge = await import("@/lib/tauri/bridge");
      if (!bridge.isTauri()) return;
      setAvailable(true);
      const savedPath = localStorage.getItem("ava.localRepoPath") ?? "";
      const savedToken = localStorage.getItem("ava.githubToken") ?? "";
      setRepoPath(savedPath);
      setToken(savedToken);
      await refresh(savedPath);
    })();
  }, [refresh]);

  if (!available) return null;

  const saveSettings = () => {
    localStorage.setItem("ava.localRepoPath", repoPath);
    localStorage.setItem("ava.githubToken", token);
    setShowSettings(false);
    void refresh(repoPath);
  };

  const commitAndPush = async () => {
    if (!repoPath || !token) { setShowSettings(true); return; }
    setPushing(true);
    setLastResult(null);
    try {
      const bridge = await import("@/lib/tauri/bridge");
      const msg = `AVA: ${status.changes} ändring${status.changes === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`;
      const commit = await bridge.gitCommitChanges(repoPath, msg);
      await bridge.gitPush(repoPath, token);
      setLastResult(`✓ Pushad: ${commit.oid.slice(0, 7)}`);
      await refresh(repoPath);
    } catch (err) {
      setLastResult(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPushing(false);
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
            onClick={commitAndPush}
            disabled={pushing || status.changes === 0}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {pushing ? "Pushar…" : "Spara & pusha"}
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
              GitHub Personal Access Token (lagras i localStorage)
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
              onClick={saveSettings}
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
