"use client";

/**
 * `pickProvider` — väljer rätt SyncProvider beroende på miljö.
 *
 * Returnerar `null` om varken Tauri eller FSA är tillgängligt, eller
 * om token/handle/path saknas. AutoSync visar då inget pill.
 */

import type { SyncProvider } from "./use-auto-sync";

export interface PickedProvider {
  provider: SyncProvider;
  kind: "tauri" | "fsa";
}

export async function pickProvider(token: string): Promise<PickedProvider | null> {
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
      } catch { /* ej tillgängligt — använd token-prop */ }
      if (!tk) return null;
      return { provider: makeTauriProvider(repoPath, tk), kind: "tauri" };
    }
  } catch { /* ignorera — bridge importerar inte i icke-Tauri */ }

  // Web FSA-detektering
  try {
    const { isFsaSupported, loadHandle, ensureReadWrite } = await import("@/lib/fsa/handle-store");
    if (!isFsaSupported()) return null;
    if (!token) return null;
    const handle = await loadHandle("repo-root");
    if (!handle) return null;
    const ok = await ensureReadWrite(handle).catch(() => false);
    if (!ok) return null;
    return { provider: makeFsaProvider(handle, token), kind: "fsa" };
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
