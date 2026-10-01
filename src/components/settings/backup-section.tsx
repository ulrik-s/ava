"use client";

/**
 * Backup (#1431): "Ta backup nu" startar hostens backupjobb (samma som
 * nattjobbet), och när den är klar laddar webbläsaren ner den krypterade
 * exporten till datorn man sitter vid. Bara för administratörer, och bara
 * när servern har backup på begäran (annars renderas inget).
 */

import { Download, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatFileSize } from "@/components/documents/_drag-helpers";
import { downloadBackup, useBackupStatus, useCanSeeBackup, useRequestBackup } from "@/lib/client/backend/server-backup";
import type { BackupExport, BackupStatus } from "@/lib/shared/backup";

/** Hur en backup återställs — steg för steg när servern är borta. */
export const RESTORE_RUNBOOK_URL = "https://github.com/ulrik-s/ava/blob/main/docs/runbook-aterstallning.md";

const when = (ms: number): string => new Date(ms).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

/**
 * Ladda ner exporten när den backup DEN HÄR fliken begärde är klar — en gång.
 * `awaitingSince` = begärans tid; en export som skrevs efter den är svaret.
 */
function useAutoDownload(status: BackupStatus | undefined, awaitingSince: number | null, done: () => void): void {
  const latest = status?.latest ?? null;
  const ready = awaitingSince !== null && status?.state === "idle" && latest !== null && latest.createdAt >= awaitingSince;
  const downloaded = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !latest || downloaded.current === latest.name) return;
    downloaded.current = latest.name;
    downloadBackup(latest.name);
    done();
  }, [ready, latest, done]);
}

/** Klockan för "nästa backup kan tas" — tickar, så knappen blir klickbar när tiden gått. */
function useNow(fixed: number | undefined): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [fixed]);
  return now;
}

function Explanation() {
  return (
    <p className="text-xs text-gray-500 mb-3">
      Tar en backup av byråns databas och alla dokument och laddar ner den till den här datorn. Filen är
      krypterad: den kan bara öppnas med byråns privata age-nyckel, som ligger i lösenordshanteraren — inte
      på servern. Hur den återställs står i{" "}
      <a href={RESTORE_RUNBOOK_URL} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">återställningsrunbooken</a>.
    </p>
  );
}

function Latest({ latest }: { latest: BackupExport | null }) {
  if (!latest) return <p className="text-sm text-gray-600">Ingen backup finns än.</p>;
  return (
    <div className="text-sm" data-testid="backup-latest">
      <p>
        Senaste backup: <span className="font-medium">{when(latest.createdAt)}</span> · {formatFileSize(latest.sizeBytes)}{" "}
        <button type="button" onClick={() => downloadBackup(latest.name)} className="ml-2 inline-flex items-center gap-1 text-blue-600 hover:underline">
          <Download size={13} /> Ladda ner
        </button>
      </p>
      <p className="mt-1 text-[11px] text-gray-500 break-all">
        {latest.name} · SHA-256: <code data-testid="backup-sha256">{latest.sha256 ?? "saknas"}</code>
        <span className="block">Kontrollera filen med <code>shasum -a 256 {latest.name}</code> — summan ska vara densamma.</span>
      </p>
    </div>
  );
}

function StateLine({ status }: { status: BackupStatus }) {
  if (status.state === "running") {
    return (
      <p className="mb-2 flex items-center gap-1 text-sm text-blue-700" role="status">
        <Loader2 size={14} className="animate-spin" /> Backup pågår (begärd {when(status.requestedAt ?? 0)}). Filen laddas ner när den är klar.
      </p>
    );
  }
  if (status.state === "failed") {
    return (
      <p className="mb-2 text-sm text-red-700" role="alert">
        Den begärda backupen blev inte klar inom en timme. Kontrollera backupjobbet på servern (<code>journalctl -u ava-backup</code>).
      </p>
    );
  }
  return null;
}

function RequestButton({ status, now, pending, onRequest }: { status: BackupStatus; now: number; pending: boolean; onRequest: () => void }) {
  const tooSoon = now < status.nextRequestAt;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" onClick={onRequest} disabled={pending || status.state === "running" || tooSoon}
        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
        Ta backup nu
      </button>
      {tooSoon && status.state !== "running" && (
        <span className="text-xs text-gray-500">Nästa backup kan tas {when(status.nextRequestAt)}.</span>
      )}
    </div>
  );
}

/** Sektionen; null för den som inte är administratör, och utan backup på servern. */
export function BackupSection({ now }: { now?: number }) {
  const visible = useCanSeeBackup();
  const status = useBackupStatus();
  const request = useRequestBackup();
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null);
  const clock = useNow(now);
  useAutoDownload(status.data, awaitingSince, () => setAwaitingSince(null));
  if (!visible) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5" data-testid="backup-section">
      <h2 className="font-semibold text-gray-900 mb-2">Backup</h2>
      <Explanation />
      {status.error && <p role="alert" className="mb-2 text-sm text-red-700">{status.error.message}</p>}
      {status.data && (
        <>
          <StateLine status={status.data} />
          <Latest latest={status.data.latest} />
          <RequestButton status={status.data} now={clock} pending={request.isPending}
            onRequest={() => request.mutate(undefined, { onSuccess: (s) => setAwaitingSince(s.requestedAt) })} />
        </>
      )}
      {request.error && <p role="alert" className="mt-2 text-sm text-red-700">{request.error.message}</p>}
    </div>
  );
}
