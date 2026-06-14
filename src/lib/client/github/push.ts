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

import {
  createBlob, createTree, createCommit, updateRef,
  type RepoLocator,
} from "./api";
import { walkFsa } from "./fsa-walker";
import { readSyncState, writeSyncState, type SyncState } from "./sync-state";

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

interface ChangedFile {
  path: string;
  bytes: Uint8Array;
}
interface PushDiff {
  changed: ChangedFile[];
  deleted: string[];
}
type TreeEntry = { path: string; mode: string; type: "blob"; sha: string | null };

/** Diffa lokal working-copy mot sync-state: ändrade (sha skiljer) + raderade. */
function diffAgainstState(
  local: Array<{ path: string; bytes: Uint8Array; sha: string }>,
  state: SyncState,
): PushDiff {
  const localMap = new Map(local.map((f) => [f.path, f]));
  const changed: ChangedFile[] = [];
  const deleted: string[] = [];
  for (const f of local) {
    if (state.files[f.path] !== f.sha) changed.push({ path: f.path, bytes: f.bytes });
  }
  for (const path of Object.keys(state.files)) {
    if (!localMap.has(path)) deleted.push(path);
  }
  return { changed, deleted };
}

/** Tree-entries för GitHub create-tree (sha=null = radering). */
function buildTreeEntries(diff: PushDiff, newBlobShas: Map<string, string>): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const item of diff.changed) {
    entries.push({ path: item.path, mode: "100644", type: "blob", sha: newBlobShas.get(item.path)! });
  }
  for (const path of diff.deleted) {
    entries.push({ path, mode: "100644", type: "blob", sha: null });
  }
  return entries;
}

/** Commit-payload med valfria signature/author (utelämnas när undefined). */
function buildCommitPayload(args: PushArgs, tree: string, parent: string) {
  return {
    message: args.message,
    tree,
    parents: [parent],
    ...(args.signature !== undefined ? { signature: args.signature } : {}),
    ...(args.author !== undefined ? { author: args.author } : {}),
  };
}

/** Ny files-map: applicera ändrade SHAs + ta bort raderade. */
function applyFileChanges(
  stateFiles: Record<string, string>,
  diff: PushDiff,
  newBlobShas: Map<string, string>,
): Record<string, string> {
  const filesMap: Record<string, string> = { ...stateFiles };
  for (const item of diff.changed) filesMap[item.path] = newBlobShas.get(item.path)!;
  for (const path of diff.deleted) delete filesMap[path];
  return filesMap;
}

export async function pushViaRest(args: PushArgs): Promise<PushResult> {
  const opts = { token: args.token, ...(args.signal !== undefined ? { signal: args.signal } : {}) };
  const state = await readSyncState(args.handle);
  if (!state) {
    throw new Error("Saknar .ava/sync-state.json — gör en pull först innan push.");
  }

  const local = await walkFsa(args.handle);
  const diff = diffAgainstState(local, state);

  if (diff.changed.length === 0 && diff.deleted.length === 0) {
    return { kind: "up-to-date", head: state.lastHead, filesPushed: 0 };
  }

  // Skapa blobs parallellt
  const newBlobShas = new Map<string, string>();
  await parallelLimit(diff.changed, 8, async (item) => {
    const sha = await createBlob(args.repo, item.bytes, opts);
    newBlobShas.set(item.path, sha);
  });

  const newTreeSha = await createTree(args.repo, state.lastTree, buildTreeEntries(diff, newBlobShas), opts);
  const newCommitSha = await createCommit(args.repo, buildCommitPayload(args, newTreeSha, state.lastHead), opts);

  await updateRef(args.repo, args.branch, newCommitSha, opts);

  const newState: SyncState = {
    version: 1,
    branch: args.branch,
    lastHead: newCommitSha,
    lastTree: newTreeSha,
    lastSyncedAt: new Date().toISOString(),
    files: applyFileChanges(state.files, diff, newBlobShas),
  };
  await writeSyncState(args.handle, newState);

  return {
    kind: "pushed",
    head: newCommitSha,
    filesPushed: diff.changed.length + diff.deleted.length,
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
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}
