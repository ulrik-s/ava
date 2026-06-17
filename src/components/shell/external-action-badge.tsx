/**
 * `ExternalActionBadge` (#417, ADR 0021) — per-post indikator för en online-only-
 * handlings läge (mail/Fortnox/webhook): väntar på att skickas, skickad, eller
 * misslyckad. Komplement till `QueuedBadge` (#416, sync-status) — den här gäller
 * den EXTERNA sido-effekten, inte sync:en av datat.
 *
 * Rent presentationell; status härleds av `externalActionStatus` ur dispatch-/
 * job-state och matas in.
 */

import type { ExternalActionStatus } from "@/lib/client/sync/external-actions";

interface Props {
  status: ExternalActionStatus;
}

interface BadgeView {
  icon: string;
  label: string;
  cls: string;
}

const VIEWS: Record<ExternalActionStatus, BadgeView> = {
  pending: { icon: "⏳", label: "Skickas när du är online igen", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  done: { icon: "✓", label: "Skickad", cls: "bg-green-50 text-green-800 border-green-200" },
  failed: { icon: "⚠", label: "Misslyckades — försök igen", cls: "bg-red-50 text-red-800 border-red-200" },
};

export function ExternalActionBadge({ status }: Props) {
  const { icon, label, cls } = VIEWS[status];
  return (
    <span
      data-testid="external-action-badge"
      data-status={status}
      className={`text-[11px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${cls}`}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </span>
  );
}
