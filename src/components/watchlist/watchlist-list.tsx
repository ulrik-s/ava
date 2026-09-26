"use client";

/**
 * Presentation av "Att bevaka"-poster (#1062). Delas av startsidans kort och
 * den fullständiga sidan — samma rad ska se likadan ut på båda ställena,
 * annars börjar folk lita på det ena och inte det andra.
 *
 * Komponenten är ren presentation: all härledning sker i
 * `@/lib/shared/watchlist` och all hämtning i anropande vy.
 */

import { DeadlineBadge } from "@/components/tasks/deadline-badge";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { formatCurrency } from "@/lib/client/utils";
import { deadlineOf } from "@/lib/shared/deadline";
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

/**
 * Inne (dagen är här) eller passerad (#1167): ska inte gå att missa. En
 * tidsfrist på själva dagen räknas som "närmar sig" i härledningen men är
 * precis det som måste göras NU — så den blir röd här.
 */
function isDue(item: WatchlistItem): boolean {
  if (item.severity === "passed") return true;
  return item.kind === "deadline" && deadlineOf(item.at).state === "today";
}

/** Bocka av en tidsfrist direkt i listan (#1167). Utelämnad → ingen kryssruta. */
type OnComplete = (taskId: string) => void;

/** Kryssrutan för en tidsfrist som kan bockas av; annars inget. */
function CompleteBox({ item, onComplete }: { item: WatchlistItem; onComplete?: OnComplete | undefined }) {
  const taskId = item.taskId;
  if (!onComplete || !taskId) return null;
  return (
    <input type="checkbox" className="mt-3" aria-label={`Markera klar: ${item.title}`}
      onChange={() => onComplete(taskId)} />
  );
}

/** Radens rubrik: inne/passerad tidsfrist med röd etikett och stor fet text. */
function RowTitle({ item, due }: { item: WatchlistItem; due: boolean }) {
  return (
    <>
      {due && item.kind === "deadline" && <DeadlineBadge dueAt={item.at} />}
      <span className={due ? "text-lg font-extrabold" : "font-semibold"}>{item.title}</span>
    </>
  );
}

export function WatchlistRow({ item, onComplete }: { item: WatchlistItem; onComplete?: OnComplete | undefined }) {
  const meta = KIND_META[item.kind];
  const due = isDue(item);
  return (
    <li className="flex items-start gap-2">
      <CompleteBox item={item} onComplete={onComplete} />
      <EntityLink
        route={item.link?.route ?? "matters"}
        id={item.link?.id}
        className={`block flex-1 rounded-lg border px-3 py-2 text-sm hover:brightness-95 ${due ? "border-2 border-red-600 bg-red-50 text-red-900" : severityClasses(item.severity)}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span aria-hidden="true">{meta.icon}</span>
          <RowTitle item={item} due={due} />
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
      </EntityLink>
    </li>
  );
}

export function WatchlistList({ items, emptyText, onComplete }: {
  items: readonly WatchlistItem[]; emptyText: string; onComplete?: OnComplete | undefined;
}) {
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
        <WatchlistRow key={`${item.kind}-${item.matterId ?? "-"}-${i}`} item={item} onComplete={onComplete} />
      ))}
    </ul>
  );
}
