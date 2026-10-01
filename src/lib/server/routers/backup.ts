/**
 * `backup` — backup på begäran från Inställningar (#1431). Bara administratörer.
 *
 * `request` lägger en begäran som hostens systemd-enhet reagerar på (samma
 * `ava-backup.service` som nattjobbet), `status` säger om den pågår och vilken
 * den nyaste krypterade exporten är. Själva filen strömmas av HTTP-routen
 * `/api/backup/download` (`http/backup-download.ts`), inte genom tRPC.
 *
 * Porten (`ctx.ports.backup`) finns bara i server-first med backupkatalogerna
 * monterade. I webbläsaren (in-process) saknas den → NOT_IMPLEMENTED; klienten
 * anropar därför serverns tRPC direkt (`client/backend/server-backup.ts`).
 */

import { TRPCError } from "@trpc/server";
import { backupStatusSchema, type BackupStatus } from "@/lib/shared/backup";
import { log } from "@/lib/shared/observability/logger";
import { uuidv7 } from "@/lib/shared/uuid";
import { assertAdmin } from "../auth/assert-admin";
import { assertMayRequest, backupStatus } from "../backup/backup-state";
import type { IBackupStore } from "../ports";
import { orgProcedure, router } from "../trpc";

function requireBackup(store: IBackupStore | undefined): IBackupStore {
  if (!store) throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Backup på begäran är inte konfigurerad på servern." });
  return store;
}

async function currentStatus(store: IBackupStore, now: number): Promise<BackupStatus> {
  const [latest, request] = await Promise.all([store.latestExport(), store.readRequest()]);
  return backupStatus(latest, request, now);
}

export const backupRouter = router({
  /** Pågår en backup, och vilken är den nyaste exporten? */
  status: orgProcedure.output(backupStatusSchema).query(({ ctx }) => {
    assertAdmin(ctx);
    return currentStatus(requireBackup(ctx.ports.backup), Date.now());
  }),

  /** Begär en backup nu. Vägras om en pågår eller om den förra är för färsk. */
  request: orgProcedure.output(backupStatusSchema).mutation(async ({ ctx }) => {
    assertAdmin(ctx);
    const store = requireBackup(ctx.ports.backup);
    const now = Date.now();
    const before = await currentStatus(store, now);
    assertMayRequest(before, now);
    const request = { requestId: uuidv7(now), requestedAt: now };
    await store.writeRequest(request);
    // Granskningsloggen: vem och när — bara id:n.
    log.info("backup.requested", { userId: ctx.user.id, orgId: ctx.orgId, ids: [request.requestId], ...(ctx.requestId ? { requestId: ctx.requestId } : {}) });
    return backupStatus(before.latest, request, now);
  }),
});
