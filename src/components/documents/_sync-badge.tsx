/**
 * `SyncStatusBadge` — per-dokument-markering driven av AVA Helperns lokala
 * upload-kö (ADR 0031 §write-back). Tre tillstånd:
 *   - `pending`  → "⟳ Väntar på server" (ändringar sparade lokalt, ej uppladdade)
 *   - `synced`   → "✓ Synkad" (transient bekräftelse ~1 min efter lyckad upload)
 *   - `conflict` → "⚠ Konflikt" (server gått förbi; 409)
 * Synkade-i-vila-dokument får ingen badge (ren lista). Funkar bäst när helpern
 * kör på samma dator (lokal kö). Ren presentationskomponent.
 */

import type { DocSyncStatus } from "@/lib/client/helper/use-helper";

export type SyncStatus = DocSyncStatus;

const BADGE = "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded";

export function SyncStatusBadge({ status }: { status?: SyncStatus | undefined }) {
  if (status === undefined) return null;
  if (status === "conflict") {
    return (
      <span
        className={`${BADGE} bg-red-100 text-red-800`}
        title={
          "Dokumentet ändrades av någon annan medan du redigerade. Din version har sparats " +
          "SEPARAT som en \"(din ändring …)\"-kopia i listan — inget är borta. Öppna båda och " +
          "kopiera över det du vill behålla (i Word: Granska → Jämför)."
        }
      >
        ⚠ Konflikt — din version sparad separat
      </span>
    );
  }
  if (status === "synced") {
    return (
      <span className={`${BADGE} bg-green-100 text-green-800`} title="Dina ändringar är synkade till servern.">
        ✓ Synkad
      </span>
    );
  }
  return (
    <span
      className={`${BADGE} bg-amber-100 text-amber-800`}
      title="Ändringar sparade lokalt och väntar på att synkas till servern (AVA Helper). Vänta tills det är klart innan du öppnar igen — annars ser du den gamla versionen."
    >
      <span className="animate-pulse">⟳</span> Väntar på server
    </span>
  );
}
