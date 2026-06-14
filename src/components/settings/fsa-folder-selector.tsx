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
import type { FsClient } from "isomorphic-git";

const HANDLE_KEY = "repo-root";

/** Browser-specifikt "stöder inte FSA"-meddelande (ren — testbar). */
function unsupportedMessage(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const reason = ua.includes("Firefox")
    ? "Firefox stöder inte File System Access API."
    : ua.includes("Safari") && !ua.includes("Chrome")
    ? "Safari stöder inte File System Access API."
    : "Den här webbläsaren stöder inte File System Access API.";
  return `${reason} Använd Chrome, Edge, Brave eller Opera för skrivstöd.`;
}

/**
 * Är handle:n ett *fungerande* git-repo? Vi nöjer oss inte med att
 * .git/-mappen finns — den kan vara halv-skapad från en avbruten clone.
 * Kräver att HEAD kan resolvas.
 */
async function probeHasGit(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await handle.getDirectoryHandle(".git");
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    const git = await import("isomorphic-git");
    await git.resolveRef({ fs: new FsaIsoGitAdapter(handle) as unknown as FsClient, dir: "/", ref: "HEAD" });
    return true;
  } catch {
    return false;
  }
}

/** Läs ev. sparad handle + verifiera rw-access + git-status. */
async function loadExistingHandle(): Promise<{ handle: FileSystemDirectoryHandle; hasGit: boolean } | null> {
  const { loadHandle, ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
  const h = await loadHandle(HANDLE_KEY);
  if (!h) return null;
  const ok = await ensureReadWrite(h).catch(() => false);
  if (!ok) return null;
  return { handle: h, hasGit: await probeHasGit(h) };
}

/** Öppna mapp-väljaren i readwrite-läge. Returnerar null vid avbrutet
 *  (ingen err) eller nekat skrivtillstånd (sätter err). */
async function pickWritableDir(setErr: (e: string | null) => void): Promise<FileSystemDirectoryHandle | null> {
  const { ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
  const win = window as Window & {
    showDirectoryPicker?: (o: { mode: string }) => Promise<FileSystemDirectoryHandle>;
  };
  const picked = await win.showDirectoryPicker?.({ mode: "readwrite" });
  if (!picked) return null;
  if (!(await ensureReadWrite(picked))) {
    setErr("Skrivtillstånd nekat");
    return null;
  }
  return picked;
}

/** Mål-handle för en clone: nuvarande (om useCurrent) annars en ny vald mapp. */
async function resolveCloneTarget(
  useCurrent: boolean,
  current: FileSystemDirectoryHandle | null,
  setErr: (e: string | null) => void,
): Promise<FileSystemDirectoryHandle | null> {
  if (useCurrent && current) return current;
  return pickWritableDir(setErr);
}

export function FsaFolderSelector({ repoUrl, token }: { repoUrl: string; token: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [hasGit, setHasGit] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { isFsaSupported } = await import("@/lib/client/fsa/handle-store");
      if (!isFsaSupported()) {
        if (!cancelled) { setSupported(false); setUnsupportedReason(unsupportedMessage()); }
        return;
      }
      if (cancelled) return;
      setSupported(true);
      const existing = await loadExistingHandle();
      if (cancelled || !existing) return;
      setHandle(existing.handle);
      setHasGit(existing.hasGit);
    })();
    return () => { cancelled = true; };
  }, []);

  const pickExisting = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { saveHandle } = await import("@/lib/client/fsa/handle-store");
      const h = await pickWritableDir(setErr);
      if (!h) return;
      await saveHandle(HANDLE_KEY, h);
      setHandle(h);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Klona repo. `useCurrent` → klona till nuvarande handle (för "Klona
   * hit nu" när användaren redan valt en tom mapp). Annars be om en ny mapp.
   */
  const cloneNew = async (useCurrent = false) => {
    if (!repoUrl) { setErr("Repo-URL saknas — fyll i datakälla först"); return; }
    setBusy(true);
    setErr(null);
    try {
      const { saveHandle } = await import("@/lib/client/fsa/handle-store");
      const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
      const { cloneRepo } = await import("@/lib/client/fsa/git-ops");
      const h = await resolveCloneTarget(useCurrent, handle, setErr);
      if (!h) return;
      const fs = new FsaIsoGitAdapter(h);
      await cloneRepo(fs, { url: githubize(repoUrl), ...(token ? { token } : {}) });
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
        <SelectedFolder
          folderName={handle.name}
          hasGit={hasGit}
          busy={busy}
          repoUrl={repoUrl}
          onForget={() => void forgetFolder()}
          onCloneHere={() => void cloneNew(true)}
        />
      ) : (
        <FolderPicker
          busy={busy}
          repoUrl={repoUrl}
          onPick={() => void pickExisting()}
          onClone={() => void cloneNew()}
        />
      )}
      {err && <p className="mt-2 text-red-700">✗ {err}</p>}
    </div>
  );
}

interface SelectedFolderProps {
  folderName: string;
  hasGit: boolean | null;
  busy: boolean;
  repoUrl: string;
  onForget: () => void;
  onCloneHere: () => void;
}

/** Vald-mapp-vyn: namn + "Byt mapp", samt varning/clone om mappen saknar git. */
function SelectedFolder({ folderName, hasGit, busy, repoUrl, onForget, onCloneHere }: SelectedFolderProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-gray-700">
          Vald: <span className="font-mono text-gray-900">{folderName}</span>
        </span>
        <button type="button" onClick={onForget} className="text-gray-500 hover:underline">
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
            onClick={onCloneHere}
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
  );
}

/** Ej-vald-vyn: välj befintlig mapp eller klona repo hit. */
function FolderPicker({ busy, repoUrl, onPick, onClone }: { busy: boolean; repoUrl: string; onPick: () => void; onClone: () => void }) {
  return (
    <div className="flex gap-2 items-center">
      <button
        type="button"
        onClick={onPick}
        disabled={busy}
        className="px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
      >
        Välj befintlig mapp
      </button>
      <button
        type="button"
        onClick={onClone}
        disabled={busy || !repoUrl}
        className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
      >
        {busy ? "Arbetar…" : "Klona repo hit"}
      </button>
    </div>
  );
}

/**
 * Normalisera repo-URL till HTTPS (browsern kan inte SSH). Accepterar:
 *   - "user/repo"            → https://github.com/user/repo.git
 *   - "git@github.com:u/r"   → https://github.com/u/r.git
 *   - "https://…"             → som-är
 */
export function githubize(input: string): string {
  if (/^https?:\/\//.test(input)) return input;
  const sshMatch = input.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}/${sshMatch[2]}.git`;
  const shortMatch = input.match(/^([^/]+)\/(.+?)(?:\.git)?$/);
  if (shortMatch) return `https://github.com/${shortMatch[1]}/${shortMatch[2]}.git`;
  return input;
}
