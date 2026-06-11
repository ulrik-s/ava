"use client";

/**
 * Pull via GitHub REST API — ingen CORS-proxy behövs.
 *
 * Steg:
 *   1. GET branch head → newHead-SHA
 *   2. Om newHead == lastHead → up-to-date, klart
 *   3. GET commit → tree-SHA
 *   4. GET tree?recursive=1 → alla file-entries med blob-SHA:s
 *   5. För varje entry vars SHA INTE matchar vår lokala fil:
 *        GET /git/blobs/{sha} → skriv till FSA
 *   6. För varje fil i den gamla sync-state som INTE finns i nya tree:
 *        radera lokalt
 *   7. Skriv ny sync-state.json
 */

import { readSyncState, writeSyncState, type SyncState } from "./sync-state";
import { walkFsa, writeFile, deleteFile } from "./fsa-walker";
import {
  getBranchHead, getCommit, getTreeRecursive, getBlob, base64ToBytes,
  type RepoLocator,
} from "./api";

export interface PullArgs {
  handle: FileSystemDirectoryHandle;
  repo: RepoLocator;
  branch: string;
  token: string;
  signal?: AbortSignal;
}

export interface PullResult {
  kind: "up-to-date" | "fast-forward";
  head: string;
  filesUpdated: number;
}

/** Remote blob-SHAs per path (ignorerar tree/non-blob-entries). */
function buildRemoteFiles(treeEntries: ReadonlyArray<{ type: string; path: string; sha: string }>): Map<string, string> {
  const remoteFiles = new Map<string, string>();
  for (const e of treeEntries) {
    if (e.type === "blob") remoteFiles.set(e.path, e.sha);
  }
  return remoteFiles;
}

/** Filer att hämta: i remote, men saknas lokalt eller har annan SHA. */
function computeFetchList(remoteFiles: Map<string, string>, localMap: Map<string, string>): Array<{ path: string; sha: string }> {
  const toFetch: Array<{ path: string; sha: string }> = [];
  for (const [path, sha] of remoteFiles) {
    if (localMap.get(path) !== sha) toFetch.push({ path, sha });
  }
  return toFetch;
}

/** Filer att radera: fanns i förra sync-state men inte i remote nu. */
function computeDeleteList(state: SyncState | null, remoteFiles: Map<string, string>): string[] {
  if (!state) return [];
  return Object.keys(state.files).filter((path) => !remoteFiles.has(path));
}

export async function pullViaRest(args: PullArgs): Promise<PullResult> {
  const opts = { token: args.token, ...(args.signal !== undefined ? { signal: args.signal } : {}) };
  const state = await readSyncState(args.handle);

  const newHead = await getBranchHead(args.repo, args.branch, opts);
  if (state && state.lastHead === newHead) {
    return { kind: "up-to-date", head: newHead, filesUpdated: 0 };
  }

  const commit = await getCommit(args.repo, newHead, opts);
  const tree = await getTreeRecursive(args.repo, commit.tree.sha, opts);
  if (tree.truncated) {
    throw new Error(`Tree är för stort (>100k entries) — REST-pull kan inte hantera det. Använd CLI-clone som engångsoperation.`);
  }

  const remoteFiles = buildRemoteFiles(tree.tree);
  const localFiles = await walkFsa(args.handle);
  const localMap = new Map(localFiles.map((f) => [f.path, f.sha]));
  const toFetch = computeFetchList(remoteFiles, localMap);
  const toDelete = computeDeleteList(state, remoteFiles);

  // Parallell-fetch (men begränsad till 8 samtidigt för att undvika
  // GitHub rate-limit-burst). 5000 req/h auth räcker mer än väl.
  await parallelLimit(toFetch, 8, async (item) => {
    const blob = await getBlob(args.repo, item.sha, opts);
    const bytes = blob.encoding === "base64" ? base64ToBytes(blob.content) : new TextEncoder().encode(blob.content);
    await writeFile(args.handle, item.path, bytes);
  });

  for (const path of toDelete) {
    await deleteFile(args.handle, path);
  }

  const newState: SyncState = {
    version: 1,
    branch: args.branch,
    lastHead: newHead,
    lastTree: commit.tree.sha,
    lastSyncedAt: new Date().toISOString(),
    files: Object.fromEntries(remoteFiles),
  };
  await writeSyncState(args.handle, newState);

  return {
    kind: "fast-forward",
    head: newHead,
    filesUpdated: toFetch.length + toDelete.length,
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
      const item = items[i++];
      if (item === undefined) continue;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
