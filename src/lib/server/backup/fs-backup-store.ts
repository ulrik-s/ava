/**
 * Backupjobbet på hosten sett från server-first-containern (#1431).
 *
 *   exportDir   `/srv/backup-chroot/ava`, monterad READ-ONLY: `backup-export.sh`
 *               lägger `ava-<datum>.tar.age` + `.sha256` här.
 *   requestDir  `/srv/ava/backup-requests`, monterad skrivbar: servern lägger
 *               `request.json` här, och hostens `ava-backup-request.path`
 *               startar backupjobbet när katalogen ändras.
 *
 * Containern får ingen docker- eller host-åtkomst: den kan bara säga "nu" (en
 * fil ändras) och läsa krypterade exporter. Vad som körs bestäms av
 * systemd-enheten på hosten, aldrig av filens innehåll.
 */

import { constants } from "node:fs";
import { open, readdir, readFile, rename, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { backupFileNameSchema, sha256HexSchema, type BackupExport, type BackupFileName, type Sha256Hex } from "@/lib/shared/backup";
import type { BackupExportStream, BackupRequest, IBackupStore } from "../ports";

/** Katalogerna (sökvägar i containern). */
export interface BackupDirs {
  exportDir: string;
  requestDir: string;
}

/** Filen hosten bevakar (via katalogen). */
export const BACKUP_REQUEST_FILE = "request.json";

/** Strömmens bitar. Stora nog att inte bli tusentals anrop, små nog för minnet. */
const CHUNK_BYTES = 1 << 20;

const backupRequestSchema = z.object({
  requestId: z.string().uuid(),
  requestedAt: z.number().int().nonnegative(),
}).strict();

/** Den nyaste exporten bland katalogens namn — namnet bär tiden, så den sorteras sist. */
export function newestExportName(entries: readonly string[]): BackupFileName | null {
  const names = entries.flatMap((e) => {
    const parsed = backupFileNameSchema.safeParse(e);
    return parsed.success ? [parsed.data] : [];
  });
  return names.sort().at(-1) ?? null;
}

/** Summan ur en `sha256sum`-rad (`<hex>  <fil>`); null om den inte har den formen. */
export function parseSha256File(text: string): Sha256Hex | null {
  const parsed = sha256HexSchema.safeParse(text.trim().split(/\s+/)[0]);
  return parsed.success ? parsed.data : null;
}

/** Begärandefilen; null om den saknas eller inte har serverns form. */
export function parseBackupRequest(text: string): BackupRequest | null {
  try {
    const parsed = backupRequestSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isMissing(e: unknown): boolean {
  return e instanceof Error && "code" in e && e.code === "ENOENT";
}

/** Läs en fil; null om den inte finns (andra fel kastas — de ska synas). */
async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

async function listIfExists(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}

/** Öppna en vanlig fil utan att följa symlänkar; null om den inte finns eller inte är en fil. */
async function openRegularFile(path: string): Promise<{ handle: FileHandle; size: number; mtimeMs: number } | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  const info = await handle.stat();
  if (info.isFile()) return { handle, size: info.size, mtimeMs: info.mtimeMs };
  await handle.close();
  return null;
}

/** Stäng filen; ett fel här (redan stängd) ändrar inget för den som läser. */
async function closeQuietly(handle: FileHandle): Promise<void> {
  try { await handle.close(); } catch { /* redan stängd */ }
}

/** Filen som en ström i bitar om {@link CHUNK_BYTES}; filen stängs när den är slut eller avbryts. */
export function fileStream(handle: FileHandle, chunkBytes: number = CHUNK_BYTES): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const buffer = new Uint8Array(chunkBytes);
        const { bytesRead } = await handle.read(buffer, 0, chunkBytes, null);
        if (bytesRead > 0) { controller.enqueue(buffer.subarray(0, bytesRead)); return; }
        await handle.close();
        controller.close();
      } catch (e) {
        await closeQuietly(handle);
        controller.error(e);
      }
    },
    async cancel() {
      await handle.close();
    },
  });
}

/** {@link IBackupStore} mot två monterade kataloger. */
export class FsBackupStore implements IBackupStore {
  constructor(private readonly dirs: BackupDirs) {}

  async latestExport(): Promise<BackupExport | null> {
    const name = newestExportName(await listIfExists(this.dirs.exportDir));
    if (!name) return null;
    const file = await openRegularFile(join(this.dirs.exportDir, name));
    if (!file) return null;
    await file.handle.close();
    const sha = await readIfExists(join(this.dirs.exportDir, `${name}.sha256`));
    return { name, sizeBytes: file.size, createdAt: Math.floor(file.mtimeMs), sha256: sha === null ? null : parseSha256File(sha) };
  }

  async readRequest(): Promise<BackupRequest | null> {
    const text = await readIfExists(join(this.dirs.requestDir, BACKUP_REQUEST_FILE));
    return text === null ? null : parseBackupRequest(text);
  }

  async writeRequest(request: BackupRequest): Promise<void> {
    // Skriv bredvid och byt namn: servern läser aldrig en halvskriven fil, och
    // hosten ser ändringen i katalogen oavsett.
    const tmp = join(this.dirs.requestDir, `.${BACKUP_REQUEST_FILE}.tmp`);
    await writeFile(tmp, JSON.stringify(request), { mode: 0o600 });
    await rename(tmp, join(this.dirs.requestDir, BACKUP_REQUEST_FILE));
  }

  async openExport(name: BackupFileName): Promise<BackupExportStream | null> {
    const file = await openRegularFile(join(this.dirs.exportDir, name));
    return file ? { sizeBytes: file.size, body: fileStream(file.handle) } : null;
  }
}

/** Env-nycklarna. Båda måste vara satta — annars finns ingen backup på begäran. */
export const BACKUP_ENV = { exportDir: "AVA_BACKUP_EXPORT_DIR", requestDir: "AVA_BACKUP_REQUEST_DIR" } as const;

/** Katalogerna ur miljön; null om någon saknas. */
export function backupDirsFromEnv(env: Record<string, string | undefined> = process.env): BackupDirs | null {
  const exportDir = env[BACKUP_ENV.exportDir];
  const requestDir = env[BACKUP_ENV.requestDir];
  return exportDir && requestDir ? { exportDir, requestDir } : null;
}
