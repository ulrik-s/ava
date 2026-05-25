"use client";

/**
 * `DayView` — vertikal timeline för EN dag, multi-user.
 *
 * Designval:
 *   - 24 timmars-rader; events placeras absolut inom dag-kolumnen.
 *   - Overlappande events får sub-kolumner (samma kolumnindex = parallell).
 *   - Heldag/deadlines listas separat ovanför timeline:n.
 *   - All-day-block är klickbara; tidsbundna events visar tid + titel + ägare.
 *
 * Pure helpers (`layoutEventsForDay`, `eventsForDate`, `slotsForRange`)
 * är exporterade och testas isolerat — själva React-koden är bara
 * presentation.
 */

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/client/lib/trpc";
import { colorForUserId, type UserColor } from "@/client/lib/calendar/user-colors";
import { startOfDay, sameDay, toKey } from "./_calendar-grid";

export interface DayEvent {
  id: string;
  userId: string;
  title: string;
  startAt: string | Date;
  endAt?: string | Date | null;
  allDay: boolean;
  kind: "appointment" | "deadline";
  location?: string | null;
}

interface DayViewProps {
  anchor: Date;
  onAnchorChange: (d: Date) => void;
  userIds: readonly string[];
  userNames: Readonly<Record<string, string>>;
  /** Stabil färgkarta från `buildUserColorMap`. Optional fallback. */
  userColors?: Map<string, UserColor>;
}

const HOUR_HEIGHT = 48; // px per timme
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;

export function DayView({ anchor, onAnchorChange, userIds, userNames, userColors }: DayViewProps) {
  const dayStart = useMemo(() => startOfDay(anchor), [anchor]);
  const dayEnd = useMemo(() => {
    const d = new Date(dayStart);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [dayStart]);

  const query = trpc.calendar.listForUsers.useQuery(
    { userIds: [...userIds], from: dayStart, to: dayEnd },
    { staleTime: 30_000, enabled: userIds.length > 0 },
  );
  const events = query.data ?? [];
  const today = eventsForDate(events as DayEvent[], dayStart);
  const allDay = today.filter((e) => e.allDay || e.kind === "deadline");
  const timed = today.filter((e) => !e.allDay && e.kind !== "deadline");
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const layout = useMemo(() => layoutEventsForDay(timed), [timed]);

  const label = anchor.toLocaleDateString("sv-SE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Föregående dag"
            onClick={() => onAnchorChange(addDays(anchor, -1))}
            className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded">
            <ChevronLeft size={14} />
          </button>
          <button type="button" onClick={() => onAnchorChange(startOfDay(new Date()))}
            className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded">Idag</button>
          <button type="button" aria-label="Nästa dag"
            onClick={() => onAnchorChange(addDays(anchor, 1))}
            className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded">
            <ChevronRight size={14} />
          </button>
        </div>
        <h3 className="text-sm font-medium text-gray-700 capitalize">{label}</h3>
        <div className="text-xs text-gray-400">{query.isLoading ? "Laddar…" : `${today.length} event`}</div>
      </div>

      {allDay.length > 0 && (
        <div className="border-b border-gray-100 px-3 py-2 space-y-1 bg-gray-50">
          <div className="text-[10px] font-semibold uppercase text-gray-500">Heldag / Frister</div>
          {allDay.map((ev) => (
            <EventBlock
              key={ev.id}
              ev={ev}
              userName={userNames[ev.userId] ?? "?"}
              color={userColors?.get(ev.userId) ?? colorForUserId(ev.userId)}
              compact
            />
          ))}
        </div>
      )}

      <div className="relative" style={{ height: (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT }}>
        {/* timgrid */}
        {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => (
          <div key={i}
            className="absolute left-0 right-0 border-t border-gray-100 flex"
            style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}>
            <div className="w-12 shrink-0 text-[10px] text-gray-400 -mt-1.5 pl-1">
              {String(DAY_START_HOUR + i).padStart(2, "0")}:00
            </div>
            <div className="flex-1" />
          </div>
        ))}

        {/* events */}
        <div className="absolute left-12 right-0 top-0 bottom-0">
          {layout.map(({ ev, top, height, leftPct, widthPct }) => (
            <div key={ev.id} className="absolute"
              style={{ top, height, left: `${leftPct}%`, width: `${widthPct}%` }}>
              <EventBlock
                ev={ev}
                userName={userNames[ev.userId] ?? "?"}
                color={userColors?.get(ev.userId) ?? colorForUserId(ev.userId)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventBlock({ ev, userName, color, compact }: { ev: DayEvent; userName: string; color: UserColor; compact?: boolean }) {
  const c = color;
  const start = new Date(ev.startAt);
  const time = ev.allDay ? "" : start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      title={`${ev.title} — ${userName}${time ? ` · ${time}` : ""}`}
      className={`h-full rounded text-[10px] overflow-hidden border ${compact ? "px-2 py-0.5" : "px-1.5 py-1"}`}
      style={{ background: c.bg, color: c.text, borderColor: c.border }}
    >
      <div className="font-medium truncate">{time && <span className="font-mono mr-1">{time}</span>}{ev.title}</div>
      {!compact && <div className="opacity-90 truncate">{userName}{ev.location ? ` · ${ev.location}` : ""}</div>}
    </div>
  );
}

// ─── Pure helpers (exporterade för test) ───────────────────────────────────

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return x;
}

export function eventsForDate(events: readonly DayEvent[], day: Date): DayEvent[] {
  const key = toKey(day);
  return events.filter((e) => toKey(new Date(e.startAt)) === key);
}

export interface LaidOutEvent {
  ev: DayEvent;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
}

/**
 * Layout-algoritm för timade events på en dag:
 *   1. Sortera efter startAt.
 *   2. Tilldela varje event en kolumn (lägsta möjliga som inte överlappar).
 *   3. Räkna max samtidiga kolumner per "cluster" → bestäm bredd-fraktion.
 */
export function layoutEventsForDay(events: readonly DayEvent[]): LaidOutEvent[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));

  // Tilldela kolumn-index
  const colEnds: Date[] = []; // för varje kolumn: när nästa event kan börja
  const assigned: Array<{ ev: DayEvent; col: number; start: Date; end: Date }> = [];
  for (const ev of sorted) {
    const start = new Date(ev.startAt);
    const end = ev.endAt ? new Date(ev.endAt) : new Date(start.getTime() + 30 * 60_000); // default 30 min
    let col = 0;
    while (col < colEnds.length && colEnds[col].getTime() > start.getTime()) col++;
    if (col === colEnds.length) colEnds.push(end);
    else colEnds[col] = end;
    assigned.push({ ev, col, start, end });
  }

  // Räkna max overlap per cluster
  const overlapCount = (start: Date, end: Date): number => {
    let n = 0;
    for (const a of assigned) {
      if (a.start.getTime() < end.getTime() && a.end.getTime() > start.getTime()) n++;
    }
    return n;
  };

  return assigned.map(({ ev, col, start, end }) => {
    const cluster = overlapCount(start, end);
    const widthPct = 100 / Math.max(cluster, 1);
    const leftPct = col * widthPct;
    const top = ((start.getHours() + start.getMinutes() / 60) - DAY_START_HOUR) * HOUR_HEIGHT;
    const minutes = (end.getTime() - start.getTime()) / 60_000;
    const height = (minutes / 60) * HOUR_HEIGHT;
    return { ev, top, height, leftPct, widthPct };
  });
}

/** Synlig tidsrange (för clamping i layout, exporterad för test). */
export function dayBounds(): { startHour: number; endHour: number; hourHeight: number } {
  return { startHour: DAY_START_HOUR, endHour: DAY_END_HOUR, hourHeight: HOUR_HEIGHT };
}

// Återanvändbar — `sameDay` är redan exporterad från _calendar-grid, så vi
// inte duplicerar logiken.
export { sameDay };
