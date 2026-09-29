"use client";

/**
 * Avvisade ändringar (#1266) — varje rad: vad det var, varför servern sa nej,
 * och knapparna Försök igen / Kasta. Ingen avvisad ändring försvinner tyst.
 */

import { useState } from "react";
import type { RejectedChange } from "@/lib/client/backend/rejected-changes";

/** Serverns skäl på svenska — tekniska koder översätts, egna besked står kvar. */
export function explainReason(reason: string): string {
  if (reason === "stale") return "Någon annan hann ändra samma sak på servern före dig.";
  if (/^okänd entitet/.test(reason)) return "Servern känner inte igen den här typen av ändring.";
  return reason;
}

interface Props {
  items: readonly RejectedChange[];
  onRetry: (id: string) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}

function Row({ change, onRetry, onDiscard }: { change: RejectedChange } & Omit<Props, "items">) {
  const [error, setError] = useState<string | null>(null);
  const run = (fn: (id: string) => Promise<void>) => () => {
    setError(null);
    void fn(change.id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <li className="rounded border border-orange-200 bg-orange-50 p-3" data-testid="rejected-change">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium text-gray-900">{change.label}</div>
          <div className="text-sm text-gray-700">{explainReason(change.reason)}</div>
          <div className="text-xs text-gray-500">Avvisad {new Date(change.rejectedAt).toLocaleString("sv-SE")}</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={run(onRetry)} className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700">
            Försök igen
          </button>
          <button type="button" onClick={run(onDiscard)} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
            Kasta
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}

export function RejectedChangesList({ items, onRetry, onDiscard }: Props) {
  if (items.length === 0) return <p className="text-sm text-gray-500 italic">Inga avvisade ändringar — allt du gjort har sparats.</p>;
  return (
    <ul className="space-y-2">
      {items.map((c) => <Row key={c.id} change={c} onRetry={onRetry} onDiscard={onDiscard} />)}
    </ul>
  );
}
