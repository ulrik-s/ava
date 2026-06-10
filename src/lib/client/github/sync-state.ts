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

import { z } from "zod";

// Zod vid parsegränsen (#187): versionen bärs av z.literal — fel version
// eller form → null (samma utfall som förr, men validerat fält för fält).
const syncStateSchema = z.object({
  version: z.literal(1),
  branch: z.string(),
  lastHead: z.string(),
  lastTree: z.string(),
  lastSyncedAt: z.string(),
  files: z.record(z.string(), z.string()),
});

export type SyncState = z.infer<typeof syncStateSchema>;

export async function readSyncState(handle: FileSystemDirectoryHandle): Promise<SyncState | null> {
  try {
    const ava = await handle.getDirectoryHandle(".ava");
    const file = await ava.getFileHandle("sync-state.json");
    const text = await (await file.getFile()).text();
    const parsed = syncStateSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
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
