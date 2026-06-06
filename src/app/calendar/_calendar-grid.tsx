"use client";

/**
 * `CalendarGrid` — månads-/veckovy. Renderar events i en grid; rena helpers
 * (vid-prevented mot Date-mutationer) gör månadsraster och hand-test:bara.
 *
 * Vi delar inte CSS-grid med listvyn; istället deklarerar vi `grid-cols-7`
 * och en variabel höjd per row. Allt körs i UTC-månadens kontext (Sverige),
 * men ger ändå sv-SE-formatterade rubriker.
 */

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/client/trpc";
import { colorForUserId, type UserColor } from "@/lib/client/calendar/user-colors";

export interface CalendarGridEvent {
  id: string;
  userId: string;
  title: string;
  kind: "appointment" | "deadline";
  startAt: string | Date;
  endAt?: string | Date | null;
  allDay: boolean;
}

interface CalendarGridProps {
  mode: "month" | "week";
  /** Vilka användares events att visa (multi-user). Tom array → tom vy. */
  userIds: readonly string[];
  /** Map userId → namn (för tooltip). */
  userNames: Readonly<Record<string, string>>;
  /** Stabil färgkarta från `buildUserColorMap` (unika färger). Optional fallback. */
  userColors?: Map<string, UserColor>;
  /** Kontrollerad anchor från parent så dag/vecka/månad delar tidpunkt. */
  anchor: Date;
  onAnchorChange: (d: Date) => void;
  /** Klick på event-chip → öppna detalj-modal i parent. */
  onSelectEvent?: (ev: CalendarGridEvent) => void;
}

export function CalendarGrid({ mode, userIds, userNames, userColors, anchor, onAnchorChange, onSelectEvent }: CalendarGridProps) {
  const range = useMemo(() => (mode === "month" ? monthRange(anchor) : weekRange(anchor)), [mode, anchor]);
  const { data: events, isLoading } = trpc.calendar.listForUsers.useQuery(
    { userIds: [...userIds], from: range.from, to: range.to },
    { staleTime: 30_000, enabled: userIds.length > 0 },
  );

  const days = useMemo(
    () => (mode === "month" ? monthGridDays(anchor) : weekDays(anchor)),
    [mode, anchor],
  );
  const eventsByDay = useMemo(
    // Boundary-cast: tRPC-raderna är branded/optional och bredare än den lokala
    // vy-typen CalendarGridEvent; bucketEventsByDay läser bara de fält som finns.
    () => bucketEventsByDay((events ?? []) as unknown as CalendarGridEvent[], days),
    [events, days],
  );

  const monthLabel = anchor.toLocaleDateString("sv-SE", { year: "numeric", month: "long" });
  const weekLabel = `Vecka ${getISOWeek(anchor)} · ${anchor.toLocaleDateString("sv-SE", { year: "numeric", month: "short" })}`;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <div className="flex items-center gap-1">
          <button
            type="button" aria-label="Föregående"
            onClick={() => onAnchorChange(shift(anchor, mode, -1))}
            className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button" onClick={() => onAnchorChange(startOfDay(new Date()))}
            className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded"
          >Idag</button>
          <button
            type="button" aria-label="Nästa"
            onClick={() => onAnchorChange(shift(anchor, mode, 1))}
            className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <h3 className="text-sm font-medium text-gray-700 capitalize">
          {mode === "month" ? monthLabel : weekLabel}
        </h3>
        <div className="text-xs text-gray-400">{isLoading ? "Laddar…" : `${events?.length ?? 0} event`}</div>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-100 text-[10px] uppercase font-semibold text-gray-500">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="px-2 py-1 text-center">{d}</div>
        ))}
      </div>

      <div className={`grid grid-cols-7 ${mode === "month" ? "auto-rows-[100px]" : "auto-rows-[160px]"}`}>
        {days.map((day) => {
          const inMonth = mode === "week" || day.getMonth() === anchor.getMonth();
          const isToday = sameDay(day, new Date());
          const dayEvents = eventsByDay.get(toKey(day)) ?? [];
          return (
            <div
              key={toKey(day)}
              data-day={toKey(day)}
              className={`border-r border-b border-gray-100 px-1.5 py-1 flex flex-col gap-0.5 overflow-hidden ${inMonth ? "bg-white" : "bg-gray-50 text-gray-400"}`}
            >
              <div className={`text-[11px] font-medium ${isToday ? "text-blue-700" : "text-gray-700"}`}>
                {day.getDate()}
              </div>
              {dayEvents.slice(0, 4).map((ev) => (
                <EventChip
                  key={ev.id}
                  ev={ev}
                  userName={userNames[ev.userId] ?? "?"}
                  color={userColors?.get(ev.userId) ?? colorForUserId(ev.userId)}
                  onClick={() => onSelectEvent?.(ev)}
                />
              ))}
              {dayEvents.length > 4 && (
                <div className="text-[10px] text-gray-500">+{dayEvents.length - 4} till</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventChip({ ev, userName, color, onClick }: { ev: CalendarGridEvent; userName: string; color: UserColor; onClick?: () => void }) {
  const start = new Date(ev.startAt);
  const time = ev.allDay ? "" : start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const deadlineRing = ev.kind === "deadline" ? "ring-1 ring-amber-400" : "";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${ev.title} — ${userName}${time ? ` · ${time}` : ""}`}
      className={`text-[10px] truncate rounded px-1 py-0.5 border text-left w-full hover:brightness-95 ${deadlineRing}`}
      style={{ background: color.bg, color: color.text, borderColor: color.border }}
    >
      {time && <span className="font-mono mr-1">{time}</span>}
      {ev.title}
    </button>
  );
}

// ─── Pure helpers (exporterade för test) ───────────────────────────────────

export const WEEKDAY_LABELS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Måndagsbaserad veckodag (0=mån, 6=sön). */
export function mondayWeekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfDay(anchor);
  start.setDate(start.getDate() - mondayWeekday(start));
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function weekRange(anchor: Date): { from: Date; to: Date } {
  const days = weekDays(anchor);
  return { from: days[0]!, to: endOfDay(days[6]!) };
}

export function monthGridDays(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - mondayWeekday(first));
  // 6 rader = 42 dagar — täcker alla månader oavsett startdag
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function monthRange(anchor: Date): { from: Date; to: Date } {
  const days = monthGridDays(anchor);
  return { from: days[0]!, to: endOfDay(days[days.length - 1]!) };
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function shift(anchor: Date, mode: "month" | "week", delta: number): Date {
  if (mode === "week") return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * delta);
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
}

/** ISO 8601 vecknummer. */
export function getISOWeek(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

export function bucketEventsByDay(events: CalendarGridEvent[], days: Date[]): Map<string, CalendarGridEvent[]> {
  const buckets = new Map<string, CalendarGridEvent[]>();
  for (const day of days) buckets.set(toKey(day), []);
  for (const ev of events) {
    const key = toKey(new Date(ev.startAt));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(ev);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  }
  return buckets;
}
