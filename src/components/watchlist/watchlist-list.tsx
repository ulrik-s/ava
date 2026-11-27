"use client";

/**
 * Presentation av Frister- och Att åtgärda-poster (#1062, #1734). Delas av
 * startsidans kort och de fullständiga sidorna — samma rad ska se likadan ut på båda ställena,
 * annars börjar folk lita på det ena och inte det andra.
 *
 * Komponenten är ren presentation: all härledning sker i
 * `@/lib/shared/watchlist` och all hämtning i anropande vy.
 */

import type { MatterStatusActions } from "@/components/matter/use-matter-status-actions";
import { DeadlineBadge } from "@/components/tasks/deadline-badge";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { finalRulingReason, noTimeReason } from "@/lib/shared/close-suggestion";
import { deadlineOf } from "@/lib/shared/deadline";
import { formatKr } from "@/lib/shared/kr-format";
import type { CloseSuggestionDocument, WatchlistItem, WatchlistKind } from "@/lib/shared/watchlist";

/** Ikon + etikett per signaltyp. Etiketten behövs för att raden ska gå att
 *  förstå utan att läsa hela texten när listan är lång. */
const KIND_META: Record<WatchlistKind, { icon: string; label: string }> = {
  coverageCap: { icon: "📊", label: "Täckningstak" },
  unbilled: { icon: "💰", label: "Ofakturerat" },
  deadline: { icon: "⏳", label: "Tidsfrist" },
  conflictCheck: { icon: "⚖️", label: "Jävskontroll" },
  closeSuggestion: { icon: "📁", label: "Avslut" },
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

/**
 * Klientens namn och ärendenumret överst på raden (#1965), t.ex. "Klient A ·
 * 2026-0001"; utan klient bara numret. Inget för en post utan ärende.
 */
function ClientLine({ item }: { item: WatchlistItem }) {
  if (item.matterNumber === null) return null;
  const text = item.klientName === undefined ? item.matterNumber : `${item.klientName} · ${item.matterNumber}`;
  return <div className="text-xs font-medium opacity-80">{text}</div>;
}

/** Ikon, rubrik, ärendenumret (utan `showClient`) och beloppet. */
function RowHeader({ item, due, showClient }: { item: WatchlistItem; due: boolean; showClient: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span aria-hidden="true">{KIND_META[item.kind].icon}</span>
      <RowTitle item={item} due={due} />
      {!showClient && item.matterNumber !== null && (
        <span className="text-xs opacity-80">{item.matterNumber}</span>
      )}
      {item.amountOre !== null && (
        <span className="ml-auto font-mono text-xs">{formatKr(item.amountOre)}</span>
      )}
    </div>
  );
}

/** Radens props. `showClient` (#1965): klient och ärendenummer överst i stället för numret efter rubriken. */
interface RowProps { item: WatchlistItem; onComplete?: OnComplete | undefined; showClient?: boolean | undefined }

export function WatchlistRow({ item, onComplete, showClient = false }: RowProps) {
  const meta = KIND_META[item.kind];
  const due = isDue(item);
  return (
    <li className="flex items-start gap-2">
      <CompleteBox item={item} onComplete={onComplete} />
      <EntityLink
        route={item.link?.route ?? "matters"}
        id={item.link?.id}
        query={item.link?.query}
        className={`block flex-1 rounded-lg border px-3 py-2 text-sm hover:brightness-95 ${due ? "border-2 border-red-600 bg-red-50 text-red-900" : severityClasses(item.severity)}`}
      >
        {showClient && <ClientLine item={item} />}
        <RowHeader item={item} due={due} showClient={showClient} />
        <p className="mt-0.5 text-xs opacity-90">
          <span className="sr-only">{meta.label}: </span>
          {item.detail}
        </p>
      </EntityLink>
    </li>
  );
}

/** Knapparna på frågan om avslut (#2100), ur `useMatterStatusActions`. */
export type CloseActions = Pick<MatterStatusActions, "close" | "keepActive" | "isPending">;

const BUTTON = "rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50";

/**
 * Öppna dokumentet bakom ett skäl i ny flik (#2101), som en träff i
 * Dokumentsökning: tier-beslutet tas vid körning (`openMatterDocument`).
 */
async function openRulingDocument(doc: CloseSuggestionDocument): Promise<void> {
  const { openMatterDocument } = await import("@/lib/client/firma/open-matter-document");
  await openMatterDocument({ id: doc.id, storagePath: doc.storagePath, fileName: doc.fileName });
}

/**
 * Skälen till frågan om avslut: tidsskälet först, sedan ett per dokument
 * (#2101). Filnamnet är en knapp som öppnar dokumentet.
 */
function CloseReasons({ suggestion }: { suggestion: NonNullable<WatchlistItem["closeSuggestion"]> }) {
  return (
    <div className="mt-0.5 space-y-0.5 text-xs opacity-90">
      <span className="sr-only">{KIND_META.closeSuggestion.label}: </span>
      {suggestion.noTimeSince !== null && <p>{noTimeReason(suggestion.noTimeSince)}</p>}
      {suggestion.documents.map((d) => (
        <p key={d.id}>
          <button type="button" className="font-medium underline hover:no-underline"
            onClick={() => void openRulingDocument(d)}>
            {d.fileName}
          </button>{" "}
          {finalRulingReason(d.ruling)}
        </p>
      ))}
    </div>
  );
}

/**
 * Ska ärendet markeras som avslutat? (#2100): rubriken och ärendenumret är en
 * länk till ärendet, skälen under, och knapparna (också dokumentens, #2101)
 * ligger utanför länken (som `CompleteBox`) så att ett klick inte också öppnar
 * ärendet.
 */
function CloseSuggestionRow({ item, suggestion, actions }: {
  item: WatchlistItem; suggestion: NonNullable<WatchlistItem["closeSuggestion"]>; actions: CloseActions;
}) {
  const id = item.matterId ?? "";
  return (
    <li className={`rounded-lg border px-3 py-2 text-sm ${severityClasses(item.severity)}`}>
      <EntityLink route="matters" id={id} className="block hover:underline">
        <RowHeader item={item} due={false} showClient={false} />
      </EntityLink>
      <CloseReasons suggestion={suggestion} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={actions.isPending} className={`${BUTTON} bg-blue-600 text-white hover:bg-blue-700`}
          onClick={() => actions.close({ id, title: suggestion.matterTitle })}>
          Avsluta ärendet
        </button>
        <button type="button" disabled={actions.isPending} className={`${BUTTON} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
          onClick={() => actions.keepActive(id)}>
          Behåll som aktivt
        </button>
      </div>
    </li>
  );
}

/** En post: frågan om avslut med knappar när `closeActions` finns, annars en vanlig rad. */
function ListRow({ item, onComplete, showClient, closeActions }: RowProps & { closeActions?: CloseActions | undefined }) {
  const suggestion = item.closeSuggestion;
  if (closeActions && suggestion) return <CloseSuggestionRow item={item} suggestion={suggestion} actions={closeActions} />;
  return <WatchlistRow item={item} onComplete={onComplete} showClient={showClient} />;
}

export function WatchlistList({ items, emptyText, onComplete, showClient = false, closeActions }: {
  items: readonly WatchlistItem[]; emptyText: string; onComplete?: OnComplete | undefined;
  /** Klientens namn och ärendenumret överst på raden (#1965) — Startsidan och sidan Frister. */
  showClient?: boolean | undefined;
  /** Knapparna Avsluta ärendet och Behåll som aktivt (#2100) — sidan Att åtgärda. */
  closeActions?: CloseActions | undefined;
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
        <ListRow key={`${item.kind}-${item.matterId ?? "-"}-${i}`} item={item} onComplete={onComplete}
          showClient={showClient} closeActions={closeActions} />
      ))}
    </ul>
  );
}
