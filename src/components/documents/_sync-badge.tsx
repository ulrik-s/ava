/**
 * `SyncStatusBadge` — per-dokument-markering driven av AVA Helperns lokala
 * upload-kö (ADR 0031 §write-back). Visar "ändringar på ingång" medan en
 * sparning väntar på att synkas till servern (så användaren inte förvirras av
 * att återöppna och se det GAMLA innehållet), och "konflikt" vid 409.
 *
 * Funkar bäst i vanliga fallet: man redigerar på samma dator som helpern kör på
 * (juristen är ofta ensam i ärendet) → kön är lokal. Ren presentationskomponent.
 */

export type SyncStatus = "pending" | "conflict";

export function SyncStatusBadge({ status }: { status?: SyncStatus | undefined }) {
  if (status === undefined) return null;
  if (status === "conflict") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-800"
        title="Versionskonflikt — serverns version har gått förbi dina lokala ändringar. Öppna och spara igen."
      >
        ⚠ Konflikt
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700"
      title="Ändringar väntar på att synkas till servern (AVA Helper). Vänta tills det är klart innan du öppnar igen — annars ser du den gamla versionen."
    >
      <span className="animate-pulse">⟳</span> Ändringar på ingång
    </span>
  );
}
