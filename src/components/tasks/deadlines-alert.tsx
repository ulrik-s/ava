"use client";

import { AlertTriangle } from "lucide-react";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { isDeadlineDue } from "@/lib/shared/deadline";
import { DeadlineBadge } from "./deadline-badge";

interface DueTask {
  id: string;
  title: string;
  dueAt?: Date | string | null;
  status?: string | null;
  matter?: { id: string; matterNumber: string; title: string } | null;
}

/**
 * Startsidan (#1162): mina frister som är inne eller passerade, överst och i
 * rött. Visar ALLA sådana oavsett vald dag — en frist som passerades i går får
 * inte försvinna för att dagen bytt. Renderar inget när det inte finns några.
 */
export function DeadlinesAlert() {
  const me = trpc.user.current.useQuery();
  const tasks = trpc.task.list.useQuery(undefined, { enabled: !!me.data?.id });
  const due = ((tasks.data?.items ?? []) as DueTask[]).filter((t) => isDeadlineDue(t));
  if (due.length === 0) return null;
  return (
    <section aria-label="Frister som är inne" className="mb-6 rounded-lg border-2 border-red-600 bg-red-50 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-xl font-extrabold uppercase text-red-700">
        <AlertTriangle size={22} /> Frister som är inne ({due.length})
      </h2>
      <ul className="space-y-2">
        {due.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3">
            <DeadlineBadge dueAt={t.dueAt} />
            <span className="text-lg font-bold text-red-900">{t.title}</span>
            {t.matter && (
              <EntityLink route="matters" id={t.matter.id} className="text-sm text-red-800 underline">
                {t.matter.matterNumber} {t.matter.title}
              </EntityLink>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
