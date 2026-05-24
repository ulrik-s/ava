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

/** Tauri-greanen: native desktop med libgit2 via bridge. */
async function tryTauri(token: string): Promise<PickedProvider | null> {
  let bridge: typeof import("@/client/lib/integrations/tauri-bridge");
  try {
    bridge = await import("@/client/lib/integrations/tauri-bridge");
  } catch { return null; }
  if (!bridge.isTauri()) return null;
  const repoPath = localStorage.getItem("ava.localRepoPath") ?? "";
  if (!repoPath) return null;
  const tk = (await bridge.secretGet("github-token").catch(() => null)) || token;
  if (!tk) return null;
  return { provider: makeTauriProvider(repoPath, tk), kind: "tauri" };
}

/** Web/FSA/OPFS-grenen — antingen via GitHub REST eller iso-git smart-HTTP. */
async function tryFsa(token: string): Promise<PickedProvider | null> {
  const { isFsaSupported, isOpfsSupported, loadHandle, ensureReadWrite } = await import("@/client/lib/fsa/handle-store");
  if (!isFsaSupported() && !isOpfsSupported()) return null;
  const handle = await loadHandle("repo-root");
  if (!handle) return null;
  if (!(await ensureReadWrite(handle).catch(() => false))) return null;

  const { loadFirmaConfig } = await import("@/client/lib/firma/firma-config");
  const { resolveCorsProxy, isLocalOrSameOrigin } = await import("./cors-proxy");
  const cfg = loadFirmaConfig();
  const origin = window.location.origin;
  // Lokal/self-hosted git-server (docker:8080/git) tillåter anonym push →
  // token krävs inte. GitHub/fjärr kräver token.
  if (!token && !isLocalOrSameOrigin(cfg.repo, origin)) return null;

  const { parseRepoLocator } = await import("@/client/lib/github/api");
  const repoLocator = parseRepoLocator(cfg.repo);
  if (repoLocator) {
    return { provider: makeRestProvider(handle, token, repoLocator, "main"), kind: "fsa" };
  }
  // Self-hosted eller okänd URL → iso-git smart-HTTP. Lokal/samma-origin
  // (round-trip mot docker:8080/git/) → "" = ingen cors-proxy.
  const corsProxy = resolveCorsProxy({ url: cfg.repo, configured: cfg.corsProxy, origin });
  return { provider: makeFsaProvider(handle, token, corsProxy), kind: "fsa" };
}

export async function pickProvider(token: string): Promise<PickedProvider | null> {
  if (typeof window === "undefined") return null;
  const tauri = await tryTauri(token);
  if (tauri) return tauri;
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
    const { walkFsa } = await import("@/client/lib/github/fsa-walker");
    const { readSyncState } = await import("@/client/lib/github/sync-state");
    const state = await readSyncState(handle);
    const local = await walkFsa(handle);
    if (!state) {
      // Ingen sync-state ännu → inga 'ändringar' (men pull kommer initiera)
      return 0;
    }
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

  // Lokal commit-only används inte i REST-flödet (vi commit:ar via
  // GitHub:s API direkt vid push). Returnera no-op.
  const commitLocal = async (): Promise<{ oid: string | null }> => {
    return { oid: null };
  };

  const pushOnly = async (): Promise<void> => {
    const { pushViaRest } = await import("@/client/lib/github/push");
    const n = await countChanges();
    // Försök ladda Ed25519-nyckel för SSH-signering
    let signature: string | undefined;
    try {
      const { loadKeypair } = await import("@/client/lib/keys/ed25519-keypair");
      const kp = await loadKeypair();
      if (kp) {
        // Vi kan inte beräkna gpgsig FÖRRÄN vi har commit-textens
        // bytes (som inkluderar tree+parent+author/committer). GitHub:s
        // /git/commits-endpoint skapar dessa fält åt oss, så vi kan
        // inte göra det helt deterministiskt. För nu: skippa signering
        // i REST-flödet och låt UI förklara att signed commits kräver
        // helper:n (där vi har full lokal git-state).
        void kp;
      }
    } catch { /* ignorera */ }

    await pushViaRest({
      ...sharedArgs,
      message: `AVA: ${n} ändring${n === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`,
      signature,
    });
  };

  return {
    pull: async () => {
      const { pullViaRest } = await import("@/client/lib/github/pull");
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
      // pushViaRest returnerar nya head:n men vi förlorade den här —
      // läs igen från sync-state
      const { readSyncState } = await import("@/client/lib/github/sync-state");
      const state = await readSyncState(handle);
      return { oid: state?.lastHead ?? null };
    },
  };
}

function makeTauriProvider(repoPath: string, token: string): SyncProvider {
  const commitOnly = async () => {
    const b = await import("@/client/lib/integrations/tauri-bridge");
    const entries = await b.gitStatus(repoPath);
    if (entries.length === 0) return { oid: null };
    const msg = `AVA: ${entries.length} ändring${entries.length === 1 ? "" : "ar"} ${new Date().toISOString().slice(0, 10)}`;
    const commit = await b.gitCommitChanges(repoPath, msg);
    return { oid: commit.oid };
  };
  const pushOnly = async () => {
    const b = await import("@/client/lib/integrations/tauri-bridge");
    await b.gitPush(repoPath, token);
  };
  return {
    pull: async () => {
      const b = await import("@/client/lib/integrations/tauri-bridge");
      const r = await b.gitPull(repoPath, token);
      return { kind: r.kind };
    },
    countChanges: async () => {
      const b = await import("@/client/lib/integrations/tauri-bridge");
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
    const { FsaIsoGitAdapter } = await import("@/client/lib/fsa/fs-adapter");
    const { statusMatrix, stageAllAndCommit } = await import("@/client/lib/fsa/git-ops");
    const fs = new FsaIsoGitAdapter(handle);
    const entries = await statusMatrix(fs);
    if (entries.length === 0) return { oid: null };
    // Försök ladda Ed25519-nyckelpar för att signera commit:n. Om det
    // saknas eller WebCrypto inte stöder Ed25519 → fall tillbaka till
    // osignerad commit.
    let sshSigning: { publicKey: Uint8Array; privateKey: CryptoKey } | undefined;
    try {
      const { loadKeypair } = await import("@/client/lib/keys/ed25519-keypair");
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
    const { FsaIsoGitAdapter } = await import("@/client/lib/fsa/fs-adapter");
    const { pushBranch } = await import("@/client/lib/fsa/git-ops");
    const fs = new FsaIsoGitAdapter(handle);
    await pushBranch(fs, { token, corsProxy });
  };
  return {
    pull: async () => {
      const { FsaIsoGitAdapter } = await import("@/client/lib/fsa/fs-adapter");
      const { pullBranch } = await import("@/client/lib/fsa/git-ops");
      const fs = new FsaIsoGitAdapter(handle);
      const r = await pullBranch(fs, {
        token, authorName: "AVA User", authorEmail: "user@ava.local",
        corsProxy,
      });
      return { kind: r.kind };
    },
    countChanges: async () => {
      const { FsaIsoGitAdapter } = await import("@/client/lib/fsa/fs-adapter");
      const { statusMatrix } = await import("@/client/lib/fsa/git-ops");
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
