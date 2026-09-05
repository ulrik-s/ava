"use client";

/**
 * Presentation av "Att bevaka"-poster (#1062). Delas av startsidans kort och
 * den fullständiga sidan — samma rad ska se likadan ut på båda ställena,
 * annars börjar folk lita på det ena och inte det andra.
 *
 * Komponenten är ren presentation: all härledning sker i
 * `@/lib/shared/watchlist` och all hämtning i anropande vy.
 */

import Link from "next/link";
import { formatCurrency } from "@/lib/client/utils";
import type { WatchlistItem, WatchlistKind } from "@/lib/shared/watchlist";

/** Ikon + etikett per signaltyp. Etiketten behövs för att raden ska gå att
 *  förstå utan att läsa hela texten när listan är lång. */
const KIND_META: Record<WatchlistKind, { icon: string; label: string }> = {
  coverageCap: { icon: "📊", label: "Täckningstak" },
  unbilled: { icon: "💰", label: "Ofakturerat" },
  deadline: { icon: "⏳", label: "Tidsfrist" },
  overdueInvoice: { icon: "📄", label: "Förfallen faktura" },
  failedDispatch: { icon: "✉️", label: "Utskick misslyckades" },
};

/**
 * Passerat är rött, annalkande bärnsten. Färgen bär samma information som
 * sorteringen, så att en snabb blick räcker — men den är aldrig den ENDA
 * bäraren: allvarsgraden står också i klartext i rubriken.
 */
function severityClasses(severity: WatchlistItem["severity"]): string {
  return severity === "passed"
    ? "border-red-300 bg-red-50 text-red-900"
    : "border-amber-300 bg-amber-50 text-amber-900";
}

export function WatchlistRow({ item }: { item: WatchlistItem }) {
  const meta = KIND_META[item.kind];
  return (
    <li>
      <Link
        href={item.href}
        className={`block rounded-lg border px-3 py-2 text-sm hover:brightness-95 ${severityClasses(item.severity)}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span aria-hidden="true">{meta.icon}</span>
          <span className="font-semibold">{item.title}</span>
          {item.matterNumber !== null && (
            <span className="text-xs opacity-80">{item.matterNumber}</span>
          )}
          {item.amountOre !== null && (
            <span className="ml-auto font-mono text-xs">{formatCurrency(item.amountOre)}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs opacity-90">
          <span className="sr-only">{meta.label}: </span>
          {item.detail}
        </p>
      </Link>
    </li>
  );
}

export function WatchlistList({ items, emptyText }: { items: readonly WatchlistItem[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {/* Index ingår i nyckeln: två poster kan dela sort, ärende OCH datum
          (t.ex. två tidsfrister samma dag i samma ärende), och React tappar
          då den ena tyst. Listan räknas om i sin helhet vid varje hämtning och
          har ingen rad-lokal state, så indexet är stabilt nog. */}
      {items.map((item, i) => (
        <WatchlistRow key={`${item.kind}-${item.matterId ?? "-"}-${i}`} item={item} />
      ))}
    </ul>
  );
}
