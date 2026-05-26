"use client";

/**
 * `ExternalEditIndicator` — visar pågående edit-sessions från
 * `ExternalEditTracker`. Renderas högst upp i app-shellen så användaren
 * ser att en commit är på väg och kan trigga den manuellt.
 */

import { useEffect, useState } from "react";
import { getExternalEditTracker, type EditSession } from "@/lib/client/fsa/external-edit-tracker";

export function ExternalEditIndicator(): React.ReactElement | null {
  const [sessions, setSessions] = useState<EditSession[]>([]);

  useEffect(() => {
    const id = setInterval(() => {
      const t = getExternalEditTracker();
      setSessions(t?.listSessions() ?? []);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if (sessions.length === 0) return null;

  async function saveNow(docId: string): Promise<void> {
    await getExternalEditTracker()?.flushNow(docId);
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900 flex flex-wrap items-center gap-3">
      <span>📝 Externa ändringar väntar på att committas:</span>
      {sessions.map((s) => (
        <span key={s.docId} className="inline-flex items-center gap-2">
          <code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs">{s.path.split("/").pop()}</code>
          <span className="text-xs">({s.saves} sparning{s.saves === 1 ? "" : "ar"})</span>
          <button
            type="button"
            onClick={() => void saveNow(s.docId)}
            className="text-xs underline hover:no-underline text-amber-900"
          >
            Spara nu →
          </button>
        </span>
      ))}
    </div>
  );
}
