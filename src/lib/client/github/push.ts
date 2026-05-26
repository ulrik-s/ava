"use client";

/**
 * Push via GitHub REST API — ingen CORS-proxy behövs.
 *
 * Steg:
 *   1. Walk FSA → bygg karta över lokala filer + git-blob-SHA
 *   2. Diff mot sync-state.files → vad har ändrats/lagts till/raderats
 *   3. För varje ändrad/ny fil: POST /git/blobs → få ny SHA
 *   4. POST /git/trees med base_tree=lastTree + delta-entries
 *      (entries med sha=null betyder radering)
 *   5. POST /git/commits {tree, parents:[lastHead], message, signature?}
 *   6. PATCH /git/refs/heads/{branch} → newCommit
 *   7. Skriv uppdaterad sync-state.json
 */

import { readSyncState, writeSyncState, type SyncState } from "./sync-state";
import { walkFsa } from "./fsa-walker";
import {
  createBlob, createTree, createCommit, updateRef,
  type RepoLocator,
} from "./api";

export interface PushArgs {
  handle: FileSystemDirectoryHandle;
  repo: RepoLocator;
  branch: string;
  token: string;
  message: string;
  signature?: string;
  author?: { name: string; email: string };
  signal?: AbortSignal;
}

export interface PushResult {
  kind: "up-to-date" | "pushed";
  /** Nytt commit-SHA om något pushades, annars senaste kända. */
  head: string;
  filesPushed: number;
}

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async function 'pushViaRest' has a complexity of 12. Maximum allowed is 8.)
export async function pushViaRest(args: PushArgs): Promise<PushResult> {
  const opts = { token: args.token, signal: args.signal };
  const state = await readSyncState(args.handle);
  if (!state) {
    throw new Error("Saknar .ava/sync-state.json — gör en pull först innan push.");
  }

  const local = await walkFsa(args.handle);
  const localMap = new Map(local.map((f) => [f.path, f]));

  // Diff
  const changed: Array<{ path: string; bytes: Uint8Array }> = [];
  const deleted: string[] = [];

  for (const f of local) {
    const lastSha = state.files[f.path];
    if (lastSha !== f.sha) changed.push({ path: f.path, bytes: f.bytes });
  }
  for (const path of Object.keys(state.files)) {
    if (!localMap.has(path)) deleted.push(path);
  }

  if (changed.length === 0 && deleted.length === 0) {
    return { kind: "up-to-date", head: state.lastHead, filesPushed: 0 };
  }

  // Skapa blobs parallellt
  const newBlobShas = new Map<string, string>();
  await parallelLimit(changed, 8, async (item) => {
    const sha = await createBlob(args.repo, item.bytes, opts);
    newBlobShas.set(item.path, sha);
  });

  // Bygg tree-entries (sha=null = delete)
  const entries: Array<{ path: string; mode: string; type: "blob"; sha: string | null }> = [];
  for (const item of changed) {
    entries.push({
      path: item.path,
      mode: "100644",
      type: "blob",
      sha: newBlobShas.get(item.path)!,
    });
  }
  for (const path of deleted) {
    entries.push({ path, mode: "100644", type: "blob", sha: null });
  }

  const newTreeSha = await createTree(args.repo, state.lastTree, entries, opts);
  const newCommitSha = await createCommit(args.repo, {
    message: args.message,
    tree: newTreeSha,
    parents: [state.lastHead],
    signature: args.signature,
    author: args.author,
  }, opts);

  await updateRef(args.repo, args.branch, newCommitSha, opts);

  // Uppdatera sync-state med nya SHAs
  const filesMap: Record<string, string> = { ...state.files };
  for (const item of changed) {
    filesMap[item.path] = newBlobShas.get(item.path)!;
  }
  for (const path of deleted) delete filesMap[path];

  const newState: SyncState = {
    version: 1,
    branch: args.branch,
    lastHead: newCommitSha,
    lastTree: newTreeSha,
    lastSyncedAt: new Date().toISOString(),
    files: filesMap,
  };
  await writeSyncState(args.handle, newState);

  return {
    kind: "pushed",
    head: newCommitSha,
    filesPushed: changed.length + deleted.length,
  };
}

async function parallelLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
