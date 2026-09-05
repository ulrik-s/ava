"use client";

/**
 * "Att bevaka" (#1062) — allt som behöver uppmärksamhet, över alla ärenden.
 *
 * Varje signal syns redan någonstans i gränssnittet, men bara där man redan
 * tittar: täckningsvarningen inne i ärendet, förfallodagen på fakturan,
 * statusen på ett utskick. Poängen med den här sidan är motsatsen — att få veta
 * utan att öppna något.
 *
 * Inget lagras och inget går att avfärda. Posterna är härledda och städar sig
 * själva när man åtgärdat dem; se `@/lib/shared/watchlist`.
 */

import { useMemo, useState } from "react";
import { WatchlistList } from "@/components/watchlist/watchlist-list";
import { trpc } from "@/lib/client/trpc";
import type { WatchlistKind } from "@/lib/shared/watchlist";

const FILTERS: Array<{ key: WatchlistKind | "all"; label: string }> = [
  { key: "all", label: "Allt" },
  { key: "deadline", label: "Tidsfrister" },
  { key: "coverageCap", label: "Täckningstak" },
  { key: "unbilled", label: "Ofakturerat" },
  { key: "overdueInvoice", label: "Förfallna fakturor" },
  { key: "failedDispatch", label: "Misslyckade utskick" },
];

export default function WatchlistPage() {
  const [mine, setMine] = useState(true);
  const [kind, setKind] = useState<WatchlistKind | "all">("all");
  const q = trpc.watchlist.list.useQuery({ mine });

  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    return kind === "all" ? all : all.filter((i) => i.kind === kind);
  }, [q.data, kind]);

  const passed = items.filter((i) => i.severity === "passed").length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Att bevaka</h1>
          <p className="text-sm text-gray-500">
            {q.isLoading ? "Hämtar…"
              : items.length === 0 ? "Inget behöver din uppmärksamhet."
              : `${items.length} poster, varav ${passed} redan passerade.`}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
            className="rounded border-gray-300"
          />
          Bara mina ärenden
        </label>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setKind(f.key)}
            aria-pressed={kind === f.key}
            className={`rounded-full border px-3 py-1 text-xs ${
              kind === f.key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <WatchlistList
        items={items}
        emptyText={kind === "all" ? "Inget att bevaka just nu." : "Inget att bevaka i den kategorin."}
      />
    </div>
  );
}
