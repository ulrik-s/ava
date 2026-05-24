"use client";

/**
 * `.ava/sync-state.json` — lokal metadata-fil i FSA-mappen som spårar
 * vad vi senast pull:ade. Eliminerar behovet av en .git/-katalog för
 * själva sync-mekaniken (iso-git:s .git/ kan finnas kvar men används
 * inte av REST-klienten).
 *
 * Schema:
 *   {
 *     version: 1,
 *     branch: "main",
 *     lastHead: "<commit-sha>",
 *     lastTree: "<tree-sha>",
 *     lastSyncedAt: "<iso-timestamp>",
 *     files: { "<path>": "<blob-sha>" }
 *   }
 *
 * `files`-kartan låter oss snabbt avgöra om en lokal fil har ändrats
 * sedan senaste pull (jämför git-blob-SHA mot kartans värde).
 */

const PATH = ".ava/sync-state.json";

export interface SyncState {
  version: 1;
  branch: string;
  lastHead: string;
  lastTree: string;
  lastSyncedAt: string;
  files: Record<string, string>;
}

export async function readSyncState(handle: FileSystemDirectoryHandle): Promise<SyncState | null> {
  try {
    const ava = await handle.getDirectoryHandle(".ava");
    const file = await ava.getFileHandle("sync-state.json");
    const text = await (await file.getFile()).text();
    const parsed = JSON.parse(text) as SyncState;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSyncState(handle: FileSystemDirectoryHandle, state: SyncState): Promise<void> {
  const ava = await handle.getDirectoryHandle(".ava", { create: true });
  const file = await ava.getFileHandle("sync-state.json", { create: true });
  // FileSystemFileHandle.createWritable är inte synkron-stängd; await:a
  const writable = await (file as FileSystemFileHandle & {
    createWritable: () => Promise<FileSystemWritableFileStream>;
  }).createWritable();
  await writable.write(JSON.stringify(state, null, 2));
  await writable.close();
}

export function pathFor(): string { return PATH; }
