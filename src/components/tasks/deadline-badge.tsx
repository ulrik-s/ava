"use client";

import { deadlineOf } from "@/lib/shared/deadline";

/**
 * Fristens läge (#1162). Inne (i dag) eller passerad: STOR, FET, RÖD — det
 * får inte gå att missa. Kommande: diskret datum. Ingen frist: inget.
 */
export function DeadlineBadge({ dueAt, done = false }: { dueAt: Date | string | null | undefined; done?: boolean }) {
  const d = deadlineOf(dueAt);
  if (d.state === "none") return null;
  const date = new Date(dueAt as Date | string).toLocaleDateString("sv-SE");
  if (done || d.state === "upcoming") {
    return <span className="text-xs text-gray-500 whitespace-nowrap">Frist {date}</span>;
  }
  const label = d.state === "today" ? "FRIST IDAG" : `FÖRSENAD ${d.daysLate} ${d.daysLate === 1 ? "DAG" : "DAGAR"}`;
  return (
    <span role="alert" className="inline-block rounded bg-red-600 px-2 py-0.5 text-sm font-extrabold uppercase tracking-wide text-white whitespace-nowrap">
      {label}
    </span>
  );
}
