"use client";

/**
 * `FsaFolderSelector` — låter användaren välja en lokal mapp att
 * läsa/skriva mot via File System Access API. Visas inuti /settings,
 * inte som en flytande panel.
 *
 * Tre lägen:
 *   - FSA stöds inte (Safari/Firefox) → upplysning
 *   - Mapp ej vald → "Välj mapp" / "Klona repo hit"
 *   - Mapp vald → visa namn + "Byt mapp"
 */

import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";

const HANDLE_KEY = "repo-root";

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'FsaFolderSelector' has a complexity of 11. Maximum allowed is 8.)
export function FsaFolderSelector({ repoUrl, token }: { repoUrl: string; token: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [hasGit, setHasGit] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async arrow function has a complexity of 14. Maximum allowed is 8.)
    void (async () => {
      const { isFsaSupported, loadHandle, ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
      if (!isFsaSupported()) {
        const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
        const reason = ua.includes("Firefox")
          ? "Firefox stöder inte File System Access API."
          : ua.includes("Safari") && !ua.includes("Chrome")
          ? "Safari stöder inte File System Access API."
          : "Den här webbläsaren stöder inte File System Access API.";
        if (!cancelled) {
          setSupported(false);
          setUnsupportedReason(`${reason} Använd Chrome, Edge, Brave eller Opera för skrivstöd.`);
        }
        return;
      }
      if (cancelled) return;
      setSupported(true);
      const h = await loadHandle(HANDLE_KEY);
      if (!h) return;
      const ok = await ensureReadWrite(h).catch(() => false);
      if (ok && !cancelled) {
        setHandle(h);
        // Kolla om det är ett *fungerande* git-repo. Vi nöjer oss inte
        // med att .git/-mappen finns — den kan vara halv-skapad från
        // en tidigare clone som avbröts. Kräver att HEAD kan resolvas.
        try {
          await h.getDirectoryHandle(".git");
          const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
          const git = await import("isomorphic-git");
          const fsAdapter = new FsaIsoGitAdapter(h);
          await git.resolveRef({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fs: fsAdapter as any,
            dir: "/",
            ref: "HEAD",
          });
          if (!cancelled) setHasGit(true);
        } catch {
          // .git saknas, är trasig, eller HEAD är inte resolvbar
          if (!cancelled) setHasGit(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pickExisting = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { saveHandle, ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
      const win = window as Window & {
        showDirectoryPicker?: (o: { mode: string }) => Promise<FileSystemDirectoryHandle>;
      };
      const h = await win.showDirectoryPicker?.({ mode: "readwrite" });
      if (!h) return;
      if (!(await ensureReadWrite(h))) {
        setErr("Skrivtillstånd nekat");
        return;
      }
      await saveHandle(HANDLE_KEY, h);
      setHandle(h);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Klona repo. Om `useCurrent` → klona till nuvarande handle (för
   * "Klona hit nu" när användaren redan valt en tom mapp). Annars
   * be om en ny mapp.
   */
  // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async arrow function has a complexity of 11. Maximum allowed is 8.)
  const cloneNew = async (useCurrent = false) => {
    if (!repoUrl) { setErr("Repo-URL saknas — fyll i datakälla först"); return; }
    setBusy(true);
    setErr(null);
    try {
      const { saveHandle, ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
      const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
      const { cloneRepo } = await import("@/lib/client/fsa/git-ops");
      let h: FileSystemDirectoryHandle;
      if (useCurrent && handle) {
        h = handle;
      } else {
        const win = window as Window & {
          showDirectoryPicker?: (o: { mode: string }) => Promise<FileSystemDirectoryHandle>;
        };
        const picked = await win.showDirectoryPicker?.({ mode: "readwrite" });
        if (!picked) return;
        if (!(await ensureReadWrite(picked))) {
          setErr("Skrivtillstånd nekat");
          return;
        }
        h = picked;
      }
      const fs = new FsaIsoGitAdapter(h);
      await cloneRepo(fs, { url: githubize(repoUrl), token: token || undefined });
      await saveHandle(HANDLE_KEY, h);
      setHandle(h);
      setHasGit(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const forgetFolder = async () => {
    const { deleteHandle } = await import("@/lib/client/fsa/handle-store");
    await deleteHandle(HANDLE_KEY);
    setHandle(null);
  };

  if (supported === null) return null;

  if (!supported) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-600">
        <strong className="text-gray-800">Lokal mapp:</strong> {unsupportedReason}
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <FolderOpen size={14} className="text-gray-500" />
        <strong className="text-gray-800">Lokal mapp</strong>
      </div>
      {handle ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-700">
              Vald: <span className="font-mono text-gray-900">{handle.name}</span>
            </span>
            <button
              type="button"
              onClick={() => void forgetFolder()}
              className="text-gray-500 hover:underline"
            >
              Byt mapp
            </button>
          </div>
          {hasGit === false && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2">
              <p className="text-amber-900 mb-2">
                <strong>⚠ Mappen är inte ett git-repo.</strong> Klona ett
                repo hit för att kunna synka. Annars fungerar inte
                pull/push.
              </p>
              <button
                type="button"
                onClick={() => void cloneNew(true)}
                disabled={busy || !repoUrl}
                className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
              >
                {busy ? "Klonar…" : "Klona hit nu"}
              </button>
              {!repoUrl && (
                <p className="text-amber-800 mt-2">
                  Fyll i Repo-URL ovan först.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={() => void pickExisting()}
            disabled={busy}
            className="px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Välj befintlig mapp
          </button>
          <button
            type="button"
            onClick={() => void cloneNew()}
            disabled={busy || !repoUrl}
            className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
          >
            {busy ? "Arbetar…" : "Klona repo hit"}
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-red-700">✗ {err}</p>}
    </div>
  );
}

/**
 * Normalisera repo-URL till HTTPS (browsern kan inte SSH). Accepterar:
 *   - "user/repo"            → https://github.com/user/repo.git
 *   - "git@github.com:u/r"   → https://github.com/u/r.git
 *   - "https://…"             → som-är
 */
function githubize(input: string): string {
  if (/^https?:\/\//.test(input)) return input;
  const sshMatch = input.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}/${sshMatch[2]}.git`;
  const shortMatch = input.match(/^([^/]+)\/(.+?)(?:\.git)?$/);
  if (shortMatch) return `https://github.com/${shortMatch[1]}/${shortMatch[2]}.git`;
  return input;
}
