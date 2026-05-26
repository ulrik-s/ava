"use client";

/**
 * `EventDetailModal` — visar all info om en kalender-händelse + actions
 * (Ta bort, Redigera senare). Renderas vid klick på en EventChip i
 * CalendarGrid eller DayView.
 */

import Link from "next/link";
import { trpc } from "@/lib/client/trpc";
import { Trash2, X, MapPin, Clock, User as UserIcon, Briefcase, Pencil, CalendarDays, Users } from "lucide-react";
import type { UserColor } from "@/lib/client/calendar/user-colors";

export interface EventDetail {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  allDay: boolean;
  userId: string;
  matterId?: string | null;
  kind: "appointment" | "deadline";
  matter?: { id: string; matterNumber: string; title: string } | null;
  inviteeUserIds?: string[];
  inviteeContactIds?: string[];
}

interface Props {
  event: EventDetail | null;
  userName: string;
  color?: UserColor;
  onClose: () => void;
  onAfterDelete?: () => void;
  /** Klick på "Redigera" → parent öppnar redigeringsformuläret. */
  onEdit?: (ev: EventDetail) => void;
  /** Klick på "Gå till kalendern" → parent navigerar till kalender på given dag. */
  gotoCalendar?: (ev: EventDetail) => void;
}

// eslint-disable-next-line complexity
export function EventDetailModal({ event, userName, color, onClose, onAfterDelete, onEdit, gotoCalendar }: Props): React.ReactElement | null {
  const utils = trpc.useUtils();
  // Hämta user/contact-listor för att rendera invitee-namn (lazy: query
  // skickas bara när modalen är öppen)
  const orgUsers = trpc.user.list.useQuery(undefined, { enabled: !!event });
  const orgContacts = trpc.contacts.list.useQuery({ pageSize: 500 }, { enabled: !!event });
  const del = trpc.calendar.delete.useMutation({
    onSuccess: () => {
      utils.calendar.invalidate();
      onAfterDelete?.();
      onClose();
    },
  });

  if (!event) return null;

  const start = new Date(event.startAt);
  const end = event.endAt ? new Date(event.endAt) : null;
  const dateLabel = start.toLocaleDateString("sv-SE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeLabel = event.allDay
    ? "Hela dagen"
    : `${start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}${end ? ` – ${end.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : ""}`;

  function confirmDelete(): void {
    if (confirm(`Ta bort "${event?.title}"?`)) del.mutate({ id: event!.id });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl max-w-md w-full">
        <header className="flex items-start justify-between gap-3 p-5 border-b border-gray-100" style={color ? { borderTopLeftRadius: 8, borderTopRightRadius: 8, borderTop: `4px solid ${color.border}` } : undefined}>
          <div className="min-w-0">
            <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded mb-1 ${event.kind === "deadline" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
              {event.kind === "deadline" ? "Frist" : "Möte"}
            </span>
            <h2 className="text-lg font-semibold text-gray-900">{event.title}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0">
            <X size={20} />
          </button>
        </header>

        <div className="p-5 space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <Clock size={14} className="text-gray-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-gray-900">{dateLabel}</div>
              <div className="text-gray-500 text-xs">{timeLabel}</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <UserIcon size={14} className="text-gray-400 mt-0.5 shrink-0" />
            <div className="text-gray-900 flex items-center gap-2">
              {color && <span className="inline-block w-2 h-2 rounded-full" style={{ background: color.border }} />}
              {userName}
            </div>
          </div>

          {event.location && (
            <div className="flex items-start gap-2">
              <MapPin size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <span className="text-gray-900">{event.location}</span>
            </div>
          )}

          {event.matter && (
            <div className="flex items-start gap-2">
              <Briefcase size={14} className="text-gray-400 mt-0.5 shrink-0" />
              {/* OBS: <Link> (inte <a>) så Next:s basePath ("/ava") läggs på
                  → annars 404. Klick på matter-länk i modal → matter-detalj. */}
              <Link href={`/matters/${event.matter.id}`} className="text-blue-600 hover:underline">
                {event.matter.matterNumber} — {event.matter.title}
              </Link>
            </div>
          )}

          {((event.inviteeUserIds?.length ?? 0) > 0 || (event.inviteeContactIds?.length ?? 0) > 0) && (
            <div className="flex items-start gap-2">
              <Users size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <div className="text-xs text-gray-900 space-y-0.5">
                {(event.inviteeUserIds ?? []).map((uid) => {
                  const u = orgUsers.data?.users.find((x: { id: string; name: string }) => x.id === uid);
                  return <div key={uid}><span className="text-gray-400">Kollega:</span> {u?.name ?? uid}</div>;
                })}
                {(event.inviteeContactIds ?? []).map((cid) => {
                  const c = orgContacts.data?.contacts.find((x: { id: string; name: string }) => x.id === cid);
                  return <div key={cid}><span className="text-gray-400">Kontakt:</span> {c?.name ?? cid}</div>;
                })}
              </div>
            </div>
          )}

          {event.description && (
            <div className="border-t border-gray-100 pt-3 text-gray-700 whitespace-pre-wrap text-sm">
              {event.description}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <button
            type="button"
            onClick={confirmDelete}
            disabled={del.isPending}
            className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            <Trash2 size={14} /> {del.isPending ? "Tar bort…" : "Ta bort"}
          </button>
          <div className="flex items-center gap-2">
            {gotoCalendar && (
              <button
                onClick={() => gotoCalendar(event)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 hover:bg-gray-50 rounded"
                title="Hoppa till kalendervyn för den här dagen"
              >
                <CalendarDays size={14} /> Gå till kalendern
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => onEdit(event)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                <Pencil size={14} /> Redigera
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded">
              Stäng
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
