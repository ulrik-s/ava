/**
 * `QueuedBadge` (#416, ADR 0016) — per-post indikator för en rads sync-läge i
 * offline-first-vägen: "köad" (väntar på reconcile), "synkad" (server-bekräftad)
 * eller "konflikt" (surface-konflikt, ADR 0017). Komplement till den globala
 * `SyncStatusPill` — den här sätts på enskilda rader i relevanta vyer.
 *
 * Rent presentationell (status in → badge ut) så den kan placeras var som helst
 * och testas isolerat; datakällan (vilka rader som är köade) kommer från
 * `CachingSyncDataStore`-kön när vägen wire:as in.
 */

export type RowSyncStatus = "queued" | "synced" | "conflict";

interface Props {
  status: RowSyncStatus;
  /** Dölj "synkad"-fallet (default) så vyer slipper badge-brus på allt. */
  showSynced?: boolean;
}

interface BadgeView {
  icon: string;
  label: string;
  cls: string;
}

const VIEWS: Record<RowSyncStatus, BadgeView> = {
  queued: { icon: "⏳", label: "Köad", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  synced: { icon: "✓", label: "Synkad", cls: "bg-green-50 text-green-800 border-green-200" },
  conflict: { icon: "⚠", label: "Konflikt", cls: "bg-orange-50 text-orange-900 border-orange-200" },
};

export function QueuedBadge({ status, showSynced = false }: Props) {
  if (status === "synced" && !showSynced) return null;
  const { icon, label, cls } = VIEWS[status];
  return (
    <span
      data-testid="queued-badge"
      data-status={status}
      className={`text-[11px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${cls}`}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </span>
  );
}
