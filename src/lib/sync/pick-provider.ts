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
    // Läs corsProxy från firma-config (samma storage som token)
    const { loadFirmaConfig } = await import("@/lib/firma/firma-config");
    const corsProxy = loadFirmaConfig().corsProxy;
    return { provider: makeFsaProvider(handle, token, corsProxy), kind: "fsa" };
  } catch { /* ignorera */ }

  return null;
}

function makeTauriProvider(repoPath: string, token: string): SyncProvider {
  const commitOnly = async () => {
    const b = await import("@/lib/tauri/bridge");
    const entries = await b.gitStatus(repoPath);
    if (entries.length === 0) return { oid: null };
    const msg = `AVA: ${entries.length} ändring${entries.length === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`;
    const commit = await b.gitCommitChanges(repoPath, msg);
    return { oid: commit.oid };
  };
  const pushOnly = async () => {
    const b = await import("@/lib/tauri/bridge");
    await b.gitPush(repoPath, token);
  };
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
    commitLocal: commitOnly,
    push: pushOnly,
    commitAndPush: async () => {
      const c = await commitOnly();
      if (!c.oid) return { oid: null };
      await pushOnly();
      return c;
    },
  };
}

function makeFsaProvider(handle: FileSystemDirectoryHandle, token: string, corsProxy?: string): SyncProvider {
  const commitOnly = async () => {
    const { FsaIsoGitAdapter } = await import("@/lib/fsa/fs-adapter");
    const { statusMatrix, stageAllAndCommit } = await import("@/lib/fsa/git-ops");
    const fs = new FsaIsoGitAdapter(handle);
    const entries = await statusMatrix(fs);
    if (entries.length === 0) return { oid: null };
    // Försök ladda Ed25519-nyckelpar för att signera commit:n. Om det
    // saknas eller WebCrypto inte stöder Ed25519 → fall tillbaka till
    // osignerad commit.
    let sshSigning: { publicKey: Uint8Array; privateKey: CryptoKey } | undefined;
    try {
      const { loadKeypair } = await import("@/lib/keys/ed25519-keypair");
      const kp = await loadKeypair();
      if (kp) sshSigning = { publicKey: kp.rawPublicKey, privateKey: kp.privateKey };
    } catch { /* ignorera — fall back till osignerad */ }
    const oid = await stageAllAndCommit(fs, {
      message: `AVA: ${entries.length} ändring${entries.length === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`,
      authorName: "AVA User", authorEmail: "user@ava.local",
      sshSigning,
    });
    return { oid };
  };
  const pushOnly = async () => {
    const { FsaIsoGitAdapter } = await import("@/lib/fsa/fs-adapter");
    const { pushBranch } = await import("@/lib/fsa/git-ops");
    const fs = new FsaIsoGitAdapter(handle);
    await pushBranch(fs, { token, corsProxy });
  };
  return {
    pull: async () => {
      const { FsaIsoGitAdapter } = await import("@/lib/fsa/fs-adapter");
      const { pullBranch } = await import("@/lib/fsa/git-ops");
      const fs = new FsaIsoGitAdapter(handle);
      const r = await pullBranch(fs, {
        token, authorName: "AVA User", authorEmail: "user@ava.local",
        corsProxy,
      });
      return { kind: r.kind };
    },
    countChanges: async () => {
      const { FsaIsoGitAdapter } = await import("@/lib/fsa/fs-adapter");
      const { statusMatrix } = await import("@/lib/fsa/git-ops");
      const fs = new FsaIsoGitAdapter(handle);
      const entries = await statusMatrix(fs);
      return entries.length;
    },
    commitLocal: commitOnly,
    push: pushOnly,
    commitAndPush: async () => {
      const c = await commitOnly();
      if (!c.oid) return { oid: null };
      await pushOnly();
      return c;
    },
  };
}
