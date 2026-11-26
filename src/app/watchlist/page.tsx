"use client";

/**
 * Frister (#1062, #1735) — tidsfrister och "Bör faktureras", över alla ärenden.
 * Adressen är fortfarande `/watchlist` (bokmärken). Takvarningar och
 * jävskontroller står i Att åtgärda (`@/app/action-items/page`).
 *
 * Inget lagras och inget går att avfärda. Posterna är härledda och städar sig
 * själva när man åtgärdat dem; se `@/lib/shared/watchlist`.
 */

import { useMemo, useState } from "react";
import { ListPage } from "@/components/layout/list-page";
import { NewWatchForm } from "@/components/watchlist/new-watch-form";
import { useCompleteWatch } from "@/components/watchlist/use-watch-actions";
import { WatchlistList } from "@/components/watchlist/watchlist-list";
import { trpc } from "@/lib/client/trpc";
import type { WatchlistKind } from "@/lib/shared/watchlist";

const FILTERS: Array<{ key: WatchlistKind | "all"; label: string }> = [
  { key: "all", label: "Allt" },
  { key: "deadline", label: "Tidsfrister" },
  { key: "unbilled", label: "Ofakturerat" },
];

export default function WatchlistPage() {
  const [mine, setMine] = useState(true);
  const [kind, setKind] = useState<WatchlistKind | "all">("all");
  const q = trpc.watchlist.list.useQuery({ mine });
  const complete = useCompleteWatch();

  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  const items = useMemo(
    () => (kind === "all" ? all : all.filter((i) => i.kind === kind)),
    [all, kind],
  );

  // Rubriken räknar ALLA poster, inte de filtrerade. Annars påstår sidan
  // "inget behöver din uppmärksamhet" så fort man filtrerar till en tom
  // kategori — vilket är falskt och farligt när något annat brinner.
  const passed = all.filter((i) => i.severity === "passed").length;

  return (
    <ListPage
      header={(
        <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Frister</h1>
          <p className="text-sm text-gray-500">
            {q.isLoading ? "Hämtar…"
              : all.length === 0 ? "Inget behöver din uppmärksamhet."
              : `${all.length} poster, varav ${passed} redan passerade.`}
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
        </>
      )}
    >

      <NewWatchForm />

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
        onComplete={complete}
        showClient
        emptyText={kind === "all" ? "Inga frister just nu." : "Inga frister i den kategorin."}
      />
    </ListPage>
  );
}
