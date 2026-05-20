"use client";

/**
 * `AutoSync` — global auto-sync som väljer rätt provider beroende på
 * miljö (Tauri / Web FSA / ingen). Renderar bara en kompakt status-pill
 * — manuell sync görs från /settings.
 *
 * - **Tauri-builden**: libgit2-bridge mot OS-keychain. Sökväg lagras
 *   i `ava.localRepoPath`.
 * - **Web FSA**: isomorphic-git + FileSystemDirectoryHandle från IDB.
 * - **Annat (Safari/Firefox)**: renderas inte (skrivning ej möjlig).
 *
 * Token & repo-URL hämtas från firma-config (single source of truth).
 */

import { useEffect, useState } from "react";
import type { SyncProvider } from "@/lib/sync/use-auto-sync";
import { useAutoSync } from "@/lib/sync/use-auto-sync";
import { SyncStatusPill } from "./sync-status-pill";
import { useAuthMode } from "@/lib/auth/use-auth-mode";

interface Props {
  /** GitHub PAT (eller OAuth-token). Tom = ingen push möjlig → inga sync-poll. */
  token: string;
}

export function AutoSync({ token }: Props) {
  const [provider, setProvider] = useState<SyncProvider | null>(null);
  const auth = useAuthMode();
  // Sync är bara meningsfull om vi har skrivrättigheter
  const writeAllowed = auth.mode === "identified-write";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await pickProvider(token);
      if (!cancelled) setProvider(p);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const { state, notifyChange } = useAutoSync({
    provider,
    enabled: writeAllowed && provider !== null,
  });

  // Lyssna på data-ändringar från DemoDataStore → trigga debounced push
  useEffect(() => {
    if (!writeAllowed || !provider) return;
    const handler = () => notifyChange();
    window.addEventListener("ava:data-changed", handler);
    return () => window.removeEventListener("ava:data-changed", handler);
  }, [writeAllowed, provider, notifyChange]);

  if (!writeAllowed) return null;
  if (!provider) return null;

  return <SyncStatusPill state={state} />;
}

/**
 * Försök bygga en Tauri-provider först (om vi kör i desktop), annars
 * en Web FSA-provider (om FSA stöds + handle finns). Returnerar null
 * om ingen miljö är skrivbar.
 */
async function pickProvider(token: string): Promise<SyncProvider | null> {
  if (typeof window === "undefined") return null;

  // Tauri-detektering
  try {
    const bridge = await import("@/lib/tauri/bridge");
    if (bridge.isTauri()) {
      const repoPath = localStorage.getItem("ava.localRepoPath") ?? "";
      if (!repoPath) return null;
      let tk = token;
      try {
        const fromKey = await bridge.secretGet("github-token");
        if (fromKey) tk = fromKey;
      } catch { /* keychain ej tillgängligt — använd token-prop */ }
      if (!tk) return null;
      return makeTauriProvider(repoPath, tk);
    }
  } catch { /* bridge importerar inte i icke-Tauri — ok */ }

  // Web FSA-detektering
  try {
    const { isFsaSupported, loadHandle, ensureReadWrite } = await import("@/lib/fsa/handle-store");
    if (!isFsaSupported()) return null;
    if (!token) return null;
    const handle = await loadHandle("repo-root");
    if (!handle) return null;
    const ok = await ensureReadWrite(handle).catch(() => false);
    if (!ok) return null;
    return makeFsaProvider(handle, token);
  } catch { /* ignorera */ }

  return null;
}

function makeTauriProvider(repoPath: string, token: string): SyncProvider {
  return {
    pull: async () => {
      const b = await import("@/lib/tauri/bridge");
      const r = await b.gitPull(repoPath, token);
      return { kind: r.kind };
    },
    countChanges: async () => {
      const b = await import("@/lib/tauri/bridge");
      const entries = await b.gitStatus(repoPath);
      return entries.length;
    },
    commitAndPush: async () => {
      const b = await import("@/lib/tauri/bridge");
      const entries = await b.gitStatus(repoPath);
      if (entries.length === 0) return { oid: null };
      const msg = `AVA: ${entries.length} ändring${entries.length === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`;
      const commit = await b.gitCommitChanges(repoPath, msg);
      await b.gitPush(repoPath, token);
      return { oid: commit.oid };
    },
  };
}

function makeFsaProvider(handle: FileSystemDirectoryHandle, token: string): SyncProvider {
  return {
    pull: async () => {
      const { FsaIsoGitAdapter } = await import("@/lib/fsa/fs-adapter");
      const { pullBranch } = await import("@/lib/fsa/git-ops");
      const fs = new FsaIsoGitAdapter(handle);
      const r = await pullBranch(fs, { token, authorName: "AVA User", authorEmail: "user@ava.local" });
      return { kind: r.kind };
    },
    countChanges: async () => {
      const { FsaIsoGitAdapter } = await import("@/lib/fsa/fs-adapter");
      const { statusMatrix } = await import("@/lib/fsa/git-ops");
      const fs = new FsaIsoGitAdapter(handle);
      const entries = await statusMatrix(fs);
      return entries.length;
    },
    commitAndPush: async () => {
      const { FsaIsoGitAdapter } = await import("@/lib/fsa/fs-adapter");
      const { statusMatrix, stageAllAndCommit, pushBranch } = await import("@/lib/fsa/git-ops");
      const fs = new FsaIsoGitAdapter(handle);
      const entries = await statusMatrix(fs);
      if (entries.length === 0) return { oid: null };
      const oid = await stageAllAndCommit(fs, {
        message: `AVA: ${entries.length} ändring${entries.length === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`,
        authorName: "AVA User", authorEmail: "user@ava.local",
      });
      await pushBranch(fs, { token });
      return { oid };
    },
  };
}
