"use client";

/**
 * `JobsBadge` — kompakt indikator i top-baren. Visar "↻ 2 jobb körs"
 * eller "✓ Klart" eller "✗ 1 misslyckat". Klick → /jobs.
 */

import Link from "next/link";
import { useJobsSummary } from "@/lib/client/jobs/use-jobs";

interface BadgeView { icon: string; cls: string; label: string }

/**
 * Härled badge-innehåll ur jobb-summeringen, eller `null` (dölj). Aktiva jobb
 * (körande/köade) vinner över misslyckade — så "1 körs" visas även med fel i
 * historiken. Ren + exporterad (testbar; håller komponenten under complexity@8).
 */
export function jobsBadgeView(s: { queued: number; running: number; failed: number }): BadgeView | null {
  const active = s.running + s.queued;
  if (active > 0) {
    return {
      icon: "↻", cls: "bg-blue-50 text-blue-800 border-blue-200",
      label: `${active} jobb ${s.running > 0 ? "körs" : "väntar"}`,
    };
  }
  if (s.failed > 0) {
    return {
      icon: "✗", cls: "bg-red-50 text-red-800 border-red-200",
      label: `${s.failed} misslyckat${s.failed === 1 ? "" : "a"}`,
    };
  }
  return null;
}

export function JobsBadge() {
  const view = jobsBadgeView(useJobsSummary());
  if (!view) return null;
  return (
    <Link
      href="/jobs"
      title="Visa jobbkö"
      className={`text-xs px-2 py-1 rounded border inline-flex items-center gap-1.5 hover:opacity-80 ${view.cls}`}
    >
      <span aria-hidden>{view.icon}</span>
      <span>{view.label}</span>
    </Link>
  );
}
