"use client";

/**
 * `WebFsaGitSync` — webbläsar-version av Tauri-git-sync via File
 * System Access API.
 *
 * Användarflöde:
 *   1. "Välj mapp" → showDirectoryPicker, handle persisteras i IDB
 *   2. "Klona repo" om mappen är tom (URL + token)
 *   3. Live-status via polling (FileSystemObserver är inte
 *      universellt tillgängligt än)
 *   4. "Spara & pusha" → isomorphic-git commit + REST push
 *
 * Renderar null på Safari/iOS (där FSA saknas).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FsaIsoGitAdapter } from "@/lib/fsa/fs-adapter";
import {
  saveHandle, loadHandle, deleteHandle, ensureReadWrite, isFsaSupported,
} from "@/lib/fsa/handle-store";
import type { GitStatusEntry } from "@/lib/fsa/git-ops";

const HANDLE_KEY = "repo-root";
const TOKEN_STORAGE = "ava.githubToken";
const POLL_INTERVAL_MS = 5000;

interface Props {
  /** Visa bara komponenten om vi inte är i Tauri (där TauriGitSync visas istället). */
  hideIfTauri?: boolean;
}

export function WebFsaGitSync({ hideIfTauri = true }: Props) {
  const [supported, setSupported] = useState(false);
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [token, setToken] = useState("");
  const [showCloneWizard, setShowCloneWizard] = useState(false);
  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[]>([]);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [showFileList, setShowFileList] = useState(false);
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);

  // Init: kolla support + ladda persisterad handle + token
  useEffect(() => {
    (async () => {
      // Tauri-detektering (importera lazy så bridge-modulen inte krashar SSR)
      if (hideIfTauri) {
        const b = await import("@/lib/tauri/bridge");
        if (b.isTauri()) return;
      }
      if (!isFsaSupported()) return;
      setSupported(true);
      const tk = localStorage.getItem(TOKEN_STORAGE) ?? "";
      setToken(tk);
      const h = await loadHandle(HANDLE_KEY);
      if (h) {
        const ok = await ensureReadWrite(h).catch(() => false);
        if (ok) {
          setHandle(h);
          handleRef.current = h;
        }
      }
    })();
  }, [hideIfTauri]);

  const refresh = useCallback(async (): Promise<void> => {
    const h = handleRef.current;
    if (!h) return;
    try {
      const { statusMatrix } = await import("@/lib/fsa/git-ops");
      const entries = await statusMatrix(new FsaIsoGitAdapter(h));
      setStatusEntries(entries);
      setStatusErr(null);
    } catch (err) {
      setStatusErr(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Polla status (FileSystemObserver är inte universellt — polling är robust)
  useEffect(() => {
    if (!handle) return;
    void refresh();
    const t = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [handle, refresh]);

  if (!supported || !handle && !showCloneWizard) {
    if (!supported) return null;
    // Visa initial pick-folder-knapp
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-semibold text-emerald-900">Web-läge — välj din lokala mapp</h3>
        <p className="text-xs text-emerald-800 mt-0.5">
          AVA kan läsa och skriva direkt mot en mapp på din dator via File System Access API.
          Välj en befintlig klon av firmans repo, eller en tom mapp att klona till.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                const win = window as Window & { showDirectoryPicker?: (o: { mode: string }) => Promise<FileSystemDirectoryHandle> };
                const h = await win.showDirectoryPicker?.({ mode: "readwrite" });
                if (!h) return;
                if (!(await ensureReadWrite(h))) return;
                await saveHandle(HANDLE_KEY, h);
                setHandle(h);
                handleRef.current = h;
              } catch (err) {
                console.warn("Pick aborted:", err);
              }
            }}
            className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700"
          >
            Välj mapp
          </button>
          <button
            type="button"
            onClick={() => setShowCloneWizard(true)}
            className="px-3 py-1.5 text-sm bg-white border border-emerald-300 text-emerald-900 rounded hover:bg-emerald-100"
          >
            Klona nytt repo
          </button>
        </div>
      </div>
    );
  }

  if (showCloneWizard && !handle) {
    return <CloneWizard onDone={(h) => { setHandle(h); handleRef.current = h; setShowCloneWizard(false); }} onCancel={() => setShowCloneWizard(false)} />;
  }

  const changes = statusEntries.length;

  const commitAndPush = async () => {
    if (!handle || !token) {
      setLastResult("✗ Saknar token — skriv in en GitHub PAT i fältet ovan");
      return;
    }
    setBusy(true);
    setLastResult(null);
    try {
      const fs = new FsaIsoGitAdapter(handle);
      const { stageAllAndCommit, pushBranch } = await import("@/lib/fsa/git-ops");
      const oid = await stageAllAndCommit(fs, {
        message: `AVA: ${changes} ändring${changes === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`,
        authorName: "AVA User",
        authorEmail: "user@ava.local",
      });
      await pushBranch(fs, { token });
      setLastResult(`✓ Pushad: ${oid.slice(0, 7)}`);
      await refresh();
    } catch (err) {
      setLastResult(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const doPull = async () => {
    if (!handle || !token) {
      setLastResult("✗ Saknar token");
      return;
    }
    setBusy(true);
    setLastResult(null);
    try {
      const fs = new FsaIsoGitAdapter(handle);
      const { pullBranch } = await import("@/lib/fsa/git-ops");
      const r = await pullBranch(fs, {
        token, authorName: "AVA User", authorEmail: "user@ava.local",
      });
      setLastResult(`✓ Pull: ${r.kind === "up-to-date" ? "redan synkad" : `uppdaterad till ${r.head.slice(0, 7)}`}`);
      await refresh();
    } catch (err) {
      setLastResult(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Synka mot GitHub (Web)</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Lokal mapp: <span className="font-mono">{handle?.name}</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {statusErr ? `Status-fel: ${statusErr}`
              : changes === 0 ? "Inga osparade ändringar"
              : (
                <button type="button" onClick={() => setShowFileList((v) => !v)} className="text-blue-600 hover:underline">
                  {changes} osparad{changes === 1 ? "" : "e"} ändring{changes === 1 ? "" : "ar"} {showFileList ? "▴" : "▾"}
                </button>
              )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              await deleteHandle(HANDLE_KEY);
              setHandle(null);
              handleRef.current = null;
              setShowCloneWizard(false);
            }}
            className="text-xs text-gray-500 hover:text-blue-600 hover:underline"
          >
            Byt mapp
          </button>
          <button
            type="button"
            onClick={() => void doPull()}
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
      <div className="mt-2">
        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">
            GitHub Personal Access Token <em>(localStorage — inte keychain i web)</em>
          </span>
          <input
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              localStorage.setItem(TOKEN_STORAGE, e.target.value);
            }}
            placeholder="ghp_..."
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs font-mono"
          />
        </label>
      </div>
      {lastResult && <p className="mt-2 text-xs text-gray-700">{lastResult}</p>}
      {showFileList && changes > 0 && (
        <ul className="mt-3 border-t border-gray-100 pt-3 text-xs font-mono space-y-1 max-h-48 overflow-y-auto">
          {statusEntries.map((e) => (
            <li key={e.path} className="flex items-center gap-2">
              <StatusBadge status={e.status} />
              <span className="text-gray-700 truncate">{e.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    modified: "bg-amber-50 text-amber-700",
    added: "bg-green-50 text-green-700",
    deleted: "bg-red-50 text-red-700",
    untracked: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${cls[status] ?? "bg-gray-100"}`}>
      {status}
    </span>
  );
}

interface WizardProps {
  onDone: (h: FileSystemDirectoryHandle) => Promise<void> | void;
  onCancel: () => void;
}

function CloneWizard({ onDone, onCancel }: WizardProps) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doClone = async () => {
    setBusy(true);
    setErr(null);
    try {
      const win = window as Window & { showDirectoryPicker?: (o: { mode: string }) => Promise<FileSystemDirectoryHandle> };
      const h = await win.showDirectoryPicker?.({ mode: "readwrite" });
      if (!h) { setBusy(false); return; }
      if (!(await ensureReadWrite(h))) {
        setErr("Skrivtillstånd nekat");
        setBusy(false);
        return;
      }
      const fs = new FsaIsoGitAdapter(h);
      const { cloneRepo } = await import("@/lib/fsa/git-ops");
      await cloneRepo(fs, { url, token: token || undefined });
      await saveHandle(HANDLE_KEY, h);
      if (token) localStorage.setItem(TOKEN_STORAGE, token);
      await onDone(h);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6">
      <h3 className="text-sm font-semibold text-emerald-900">Klona repo till lokal mapp</h3>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <label className="block">
          <span className="text-xs text-emerald-900 mb-1 block">GitHub repo (HTTPS-URL)</span>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/<firma>/<repo>.git"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono" />
        </label>
        <label className="block">
          <span className="text-xs text-emerald-900 mb-1 block">GitHub PAT (för privata repos / push)</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono" />
        </label>
      </div>
      {err && <p className="mt-2 text-xs text-red-700">✗ {err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:underline">
          Avbryt
        </button>
        <button type="button" onClick={() => void doClone()} disabled={busy || !url}
          className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300">
          {busy ? "Klonar…" : "Välj tom mapp & klona"}
        </button>
      </div>
    </div>
  );
}
