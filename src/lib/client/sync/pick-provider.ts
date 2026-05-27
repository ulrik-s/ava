"use client";

/**
 * `pickProvider` — väljer rätt SyncProvider beroende på miljö.
 *
 * Returnerar `null` om FSA/OPFS inte är tillgängligt eller om
 * token/handle saknas. AutoSync visar då inget pill.
 *
 * Tidigare hade vi även en Tauri-gren (libgit2 native) — borttagen.
 * Browser är runtime, period.
 */

import type { SyncProvider } from "./use-auto-sync";

export interface PickedProvider {
  provider: SyncProvider;
  kind: "fsa";
}

/** Web/FSA/OPFS-grenen — antingen via GitHub REST eller iso-git smart-HTTP. */
async function tryFsa(token: string): Promise<PickedProvider | null> {
  const { isFsaSupported, isOpfsSupported, loadHandle, ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
  if (!isFsaSupported() && !isOpfsSupported()) return null;
  const handle = await loadHandle("repo-root");
  if (!handle) return null;
  if (!(await ensureReadWrite(handle).catch(() => false))) return null;

  const { loadFirmaConfig, gitAuthUsername } = await import("@/lib/client/firma/firma-config");
  const { resolveCorsProxy, isLocalOrSameOrigin } = await import("./cors-proxy");
  const cfg = loadFirmaConfig();
  const username = gitAuthUsername(cfg);
  const origin = window.location.origin;
  // Lokal/self-hosted git-server (docker:8080/git) tillåter anonym push →
  // token krävs inte. GitHub/fjärr kräver token.
  if (!token && !isLocalOrSameOrigin(cfg.repo, origin)) return null;

  const { parseRepoLocator } = await import("@/lib/client/github/api");
  const repoLocator = parseRepoLocator(cfg.repo);
  if (repoLocator) {
    return { provider: makeRestProvider(handle, token, repoLocator, "main"), kind: "fsa" };
  }
  // Self-hosted eller okänd URL → iso-git smart-HTTP. Lokal/samma-origin
  // (round-trip mot docker:8080/git/) → "" = ingen cors-proxy.
  const corsProxy = resolveCorsProxy({ url: cfg.repo, configured: cfg.corsProxy, origin });
  return { provider: makeFsaProvider(handle, token, corsProxy, username), kind: "fsa" };
}

export async function pickProvider(token: string): Promise<PickedProvider | null> {
  if (typeof window === "undefined") return null;
  return tryFsa(token).catch(() => null);
}

/**
 * REST-baserad provider — anropar bara api.github.com (CORS *), aldrig
 * git smart-HTTP eller någon proxy. Detta är primärvägen för web-builden.
 */
function makeRestProvider(
  handle: FileSystemDirectoryHandle,
  token: string,
  repo: { owner: string; repo: string },
  branch: string,
): SyncProvider {
  const sharedArgs = { handle, repo, branch, token };

  const countChanges = async (): Promise<number> => {
    const { walkFsa } = await import("@/lib/client/github/fsa-walker");
    const { readSyncState } = await import("@/lib/client/github/sync-state");
    const state = await readSyncState(handle);
    const local = await walkFsa(handle);
    if (!state) return 0;
    let changes = 0;
    const localMap = new Map(local.map((f) => [f.path, f.sha]));
    for (const f of local) {
      if (state.files[f.path] !== f.sha) changes++;
    }
    for (const path of Object.keys(state.files)) {
      if (!localMap.has(path)) changes++;
    }
    return changes;
  };

  const commitLocal = async (): Promise<{ oid: string | null }> => {
    return { oid: null };
  };

  const pushOnly = async (): Promise<void> => {
    const { pushViaRest } = await import("@/lib/client/github/push");
    const n = await countChanges();
    await pushViaRest({
      ...sharedArgs,
      message: `AVA: ${n} ändring${n === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`,
    });
  };

  return {
    pull: async () => {
      const { pullViaRest } = await import("@/lib/client/github/pull");
      const r = await pullViaRest(sharedArgs);
      return { kind: r.kind };
    },
    countChanges,
    commitLocal,
    push: pushOnly,
    commitAndPush: async () => {
      const before = await countChanges();
      if (before === 0) return { oid: null };
      await pushOnly();
      const { readSyncState } = await import("@/lib/client/github/sync-state");
      const state = await readSyncState(handle);
      return { oid: state?.lastHead ?? null };
    },
  };
}

function makeFsaProvider(handle: FileSystemDirectoryHandle, token: string, corsProxy?: string, username?: string): SyncProvider {
  const commitOnly = async () => {
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    const { statusMatrix, stageAllAndCommit } = await import("@/lib/client/fsa/git-ops");
    const fs = new FsaIsoGitAdapter(handle);
    const entries = await statusMatrix(fs);
    if (entries.length === 0) return { oid: null };
    let sshSigning: { publicKey: Uint8Array; privateKey: CryptoKey } | undefined;
    try {
      const { loadKeypair } = await import("@/lib/client/keys/ed25519-keypair");
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
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    const { pushBranch } = await import("@/lib/client/fsa/git-ops");
    const fs = new FsaIsoGitAdapter(handle);
    await pushBranch(fs, { token, username, corsProxy });
  };
  return {
    pull: async () => {
      const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
      const { pullBranch } = await import("@/lib/client/fsa/git-ops");
      const fs = new FsaIsoGitAdapter(handle);
      const r = await pullBranch(fs, {
        token, username, authorName: "AVA User", authorEmail: "user@ava.local",
        corsProxy,
      });
      return { kind: r.kind };
    },
    countChanges: async () => {
      const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
      const { statusMatrix } = await import("@/lib/client/fsa/git-ops");
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
