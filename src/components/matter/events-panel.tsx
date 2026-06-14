"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/server/routers/_app";
import { trpc } from "@/lib/client/trpc";

interface EventsPanelProps {
  matterId: string;
}

type MatterEvent = inferRouterOutputs<AppRouter>["document"]["events"][number];

function formatEventDate(startAt: Date, allDay: boolean, endAt: Date | null): string {
  const d = new Date(startAt);
  if (allDay) {
    return d.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  }
  const datePart = d.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  const timePart = d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  let endPart = "";
  if (endAt) {
    const e = new Date(endAt);
    if (e.toDateString() === d.toDateString()) {
      endPart = "–" + e.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    }
  }
  return `${datePart} kl ${timePart}${endPart}`;
}

export function EventsPanel({ matterId }: EventsPanelProps) {
  const utils = trpc.useUtils();
  const events = trpc.document.events.useQuery({ matterId });

  const reject = trpc.document.rejectEvent.useMutation({
    onSuccess: () => utils.document.events.invalidate({ matterId }),
  });

  if (events.isLoading) return null;
  const list = events.data ?? [];
  if (list.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg lg:col-span-2">
      <div className="px-6 py-4 border-b border-indigo-200">
        <h2 className="font-semibold text-indigo-900 flex items-center gap-2">
          🗓 Viktiga tidpunkter
          <span className="text-xs font-normal text-indigo-700">({list.length})</span>
        </h2>
        <p className="text-xs text-indigo-800 mt-1">
          AI har extraherat tidpunkter från dokumenten. Lägg till i din kalender
          eller ta bort om de inte är relevanta.
        </p>
      </div>
      <div className="divide-y divide-indigo-200">
        {list.map((ev) => (
          <EventRow
            key={ev.id}
            ev={ev}
            past={new Date(ev.startAt) < today}
            onAccepted={() => setTimeout(() => { void utils.document.events.invalidate({ matterId }); }, 500)}
            onReject={() => reject.mutate({ eventId: ev.id })}
            rejecting={reject.isPending}
          />
        ))}
      </div>
    </div>
  );
}

/** Status-pills för ett event (typ / i-kalendern / passerat). */
function EventBadges({ eventType, accepted, past }: { eventType: string | null | undefined; accepted: boolean; past: boolean }) {
  return (
    <>
      {eventType && (
        <span className="inline-block rounded-full bg-indigo-100 text-indigo-800 px-2 py-0.5 text-[10px] font-medium">
          {eventType}
        </span>
      )}
      {accepted && (
        <span className="inline-block rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-[10px] font-medium">
          ✓ i kalendern
        </span>
      )}
      {past && (
        <span className="inline-block rounded-full bg-gray-200 text-gray-600 px-2 py-0.5 text-[10px]">
          passerat
        </span>
      )}
    </>
  );
}

interface EventRowProps {
  ev: MatterEvent;
  past: boolean;
  onAccepted: () => void;
  onReject: () => void;
  rejecting: boolean;
}

/** En extraherad tidpunkt: titel + badges + datum/plats/beskrivning + actions. */
function EventRow({ ev, past, onAccepted, onReject, rejecting }: EventRowProps) {
  return (
    <div className={`px-6 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${past ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900">{ev.title}</span>
          <EventBadges eventType={ev.eventType} accepted={ev.status === "ACCEPTED"} past={past} />
        </div>
        <div className="text-sm text-gray-800 mt-1">
          {formatEventDate(new Date(ev.startAt), ev.allDay, ev.endAt ? new Date(ev.endAt) : null)}
        </div>
        {ev.location && (
          <div className="text-xs text-gray-600 mt-0.5">📍 {ev.location}</div>
        )}
        {ev.description && (
          <div className="text-xs text-gray-600 mt-0.5 italic">{ev.description}</div>
        )}
        <div className="text-[11px] text-gray-400 mt-1">
          Från: {ev.document.title || ev.document.fileName}
        </div>
      </div>
      <div className="flex items-start gap-2 flex-shrink-0">
        <a
          href={`/api/events/${ev.id}/ics`}
          className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700"
          title="Ladda ner .ics-fil — öppna den för att lägga till i Kalender"
          onClick={onAccepted}
        >
          📅 Lägg i kalender
        </a>
        <button
          onClick={onReject}
          disabled={rejecting}
          className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50 disabled:opacity-50"
          title="Ta bort — visas inte igen"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
