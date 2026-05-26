"use client";

/**
 * `JobsBadge` — kompakt indikator i top-baren. Visar "↻ 2 jobb körs"
 * eller "✓ Klart" eller "✗ 1 misslyckat". Klick → /jobs.
 */

import Link from "next/link";
import { useJobsSummary } from "@/lib/client/jobs/use-jobs";

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'JobsBadge' has a complexity of 11. Maximum allowed is 8.)
export function JobsBadge() {
  const { queued, running, failed } = useJobsSummary();
  if (queued === 0 && running === 0 && failed === 0) return null;

  let label: string;
  let cls: string;
  let icon: string;
  if (failed > 0 && running === 0 && queued === 0) {
    icon = "✗"; cls = "bg-red-50 text-red-800 border-red-200";
    label = `${failed} misslyckat${failed === 1 ? "" : "a"}`;
  } else if (running > 0 || queued > 0) {
    icon = "↻"; cls = "bg-blue-50 text-blue-800 border-blue-200";
    const pending = running + queued;
    label = `${pending} jobb ${running > 0 ? "körs" : "väntar"}`;
  } else {
    return null;
  }

  return (
    <Link
      href="/jobs"
      title="Visa jobbkö"
      className={`text-xs px-2 py-1 rounded border inline-flex items-center gap-1.5 hover:opacity-80 ${cls}`}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
