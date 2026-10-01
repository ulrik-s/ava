/**
 * Backup på begäran (#1431) — det klienten och servern delar.
 *
 * Exporten är `backup-export.sh`:s krypterade `ava-<datum>.tar.age` (age, bara
 * den publika nyckeln finns på servern) med en `.sha256` bredvid. Servern läser
 * exportkatalogen read-only och strömmar en export till en administratör som
 * ber om den; den kan aldrig dekryptera den.
 */

import { z } from "zod";

/** `backup-export.sh` döper exporten `ava-<YYYY-MM-DD-HHMM>.tar.age`. Inget annat tas emot. */
const BACKUP_FILE_RE = /^ava-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.age$/;

/** En exports filnamn (validerat, branded) — kan aldrig peka ut en annan fil. */
export const backupFileNameSchema = z.string().regex(BACKUP_FILE_RE, "Ogiltigt namn på backupfil.").brand<"BackupFileName">();

/** Ett validerat namn på en krypterad export. */
export type BackupFileName = z.infer<typeof backupFileNameSchema>;

/** sha256 i gemen hex — formen `sha256sum` skriver. */
export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/).brand<"Sha256Hex">();

/** En validerad sha256-summa. */
export type Sha256Hex = z.infer<typeof sha256HexSchema>;

/** Den senaste krypterade exporten. */
export const backupExportSchema = z.object({
  name: backupFileNameSchema,
  sizeBytes: z.number().int().nonnegative(),
  /** När exporten skrevs klart (filens mtime, ms). */
  createdAt: z.number().int().nonnegative(),
  /** Ur `<namn>.sha256`; null om den saknas eller är trasig. */
  sha256: sha256HexSchema.nullable(),
}).strict();

/** En krypterad export i exportkatalogen. */
export type BackupExport = z.infer<typeof backupExportSchema>;

/**
 * Läget: `idle` (ingen begäran väntar), `running` (begärd, ingen ny export
 * än) eller `failed` (begärd, men ingen ny export inom tidsgränsen).
 */
export const backupStateSchema = z.enum(["idle", "running", "failed"]);

/** Ett backupläge. */
export type BackupState = z.infer<typeof backupStateSchema>;

/** Det `backup.status` svarar. */
export const backupStatusSchema = z.object({
  state: backupStateSchema,
  latest: backupExportSchema.nullable(),
  /** När den senaste begäran gjordes (ms), om någon finns. */
  requestedAt: z.number().int().nonnegative().nullable(),
  /** Tidigast när en ny begäran tas emot (ms). */
  nextRequestAt: z.number().int().nonnegative(),
}).strict();

/** Serverns backupläge. */
export type BackupStatus = z.infer<typeof backupStatusSchema>;

/** HTTP-routen som strömmar en export (under /api: oauth2-proxy skyddar den). */
export const BACKUP_DOWNLOAD_PATH = "/api/backup/download";

/** Nedladdnings-URL:en för en export (samma origin). */
export function backupDownloadUrl(name: BackupFileName): string {
  return `${BACKUP_DOWNLOAD_PATH}?name=${encodeURIComponent(name)}`;
}
