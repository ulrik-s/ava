"use client";

/**
 * Backup på begäran (#1431). Körs PÅ SERVERN — det är där hostens backupjobb
 * och de krypterade exporterna finns — så anropen går direkt till serverns
 * tRPC, inte till routrarna i webbläsaren. Bara för administratörer, och bara
 * när servern annonserar `backup`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { trpc } from "@/lib/client/trpc";
import { backupDownloadUrl, type BackupFileName, type BackupStatus } from "@/lib/shared/backup";
import { serverTrpcClient as server } from "./server-trpc-client";

const STATUS_KEY = ["server", "backup.status"] as const;

/** Hur ofta läget hämtas medan en backup pågår. */
export const BACKUP_POLL_MS = 5_000;

/** Hämta läget igen medan en backup pågår; annars inte. */
export function backupRefetchInterval(status: BackupStatus | undefined): number | false {
  return status?.state === "running" ? BACKUP_POLL_MS : false;
}

/** Visas backupen här? (servern kan + administratör) */
export function useCanSeeBackup(): boolean {
  const { backup } = useCapabilities();
  const me = trpc.user.current.useQuery(undefined, { enabled: backup });
  return backup && me.data?.role === "ADMIN";
}

/** Serverns backupläge; hämtas om var femte sekund medan en backup pågår. */
export function useBackupStatus() {
  const enabled = useCanSeeBackup();
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: (): Promise<BackupStatus> => server().backup.status.query(),
    enabled,
    refetchInterval: (query) => backupRefetchInterval(query.state.data),
  });
}

/** Begär en backup nu; läget uppdateras med serverns svar. */
export function useRequestBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<BackupStatus> => server().backup.request.mutate(),
    onSuccess: (status) => { qc.setQueryData(STATUS_KEY, status); },
  });
}

/**
 * Ladda ner exporten till den här datorn. En vanlig länk-navigering: webbläsaren
 * sparar filen direkt till disk (ingen kopia i minnet) och skickar sessionens
 * cookie, så oauth2-proxy och servern kontrollerar vem det är.
 */
export function downloadBackup(name: BackupFileName, doc: Document = document): void {
  const a = doc.createElement("a");
  a.href = backupDownloadUrl(name);
  a.download = name;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  a.remove();
}
