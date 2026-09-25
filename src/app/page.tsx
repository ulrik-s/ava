"use client";

/**
 * Dashboard — översikt för inloggad användare:
 *   - "Att bevaka" — härledda påminnelser (#1062)
 *   - "Att bevaka" överst — frister/bevakningar i rött när de är inne (#1167)
 *   - "Kalender" för vald dag (möten, förhandlingar)
 *   - Tidrapportering för vald dag (summa + lista)
 *   - Senaste 5 ärenden man jobbat i (timeEntry order desc, dedup)
 *
 * Dagsval: Igår / Idag / Imorgon / fritt datum.
 */

import { Plus, Calendar as CalendarIcon, Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { sectionHeaderClass } from "@/components/ui/section-tone";
import { useCompleteWatch } from "@/components/watchlist/use-watch-actions";
import { WatchlistList } from "@/components/watchlist/watchlist-list";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function offsetDayYmd(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeForDay(ymd: string): { from: Date; to: Date } {
  const from = new Date(`${ymd}T00:00:00`);
  const to = new Date(`${ymd}T23:59:59.999`);
  return { from, to };
}

function dayLabel(ymd: string): string {
  if (ymd === todayYmd()) return "Idag";
  if (ymd === offsetDayYmd(1)) return "Igår";
  if (ymd === offsetDayYmd(-1)) return "Imorgon";
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("sv-SE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export default function Dashboard() {
  const [ymd, setYmd] = useState<string>(todayYmd());

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Startsida</h1>
          <p className="text-sm text-gray-500 capitalize">{dayLabel(ymd)}</p>
        </div>
        <DaySwitcher ymd={ymd} onChange={setYmd} />
      </div>

      <WatchlistCard />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <CalendarCard ymd={ymd} />
        <TimeCard ymd={ymd} />
      </div>

      <RecentMattersCard />
    </div>
  );
}

/** Hur många poster som ryms på startsidan innan man skickas vidare. */
const DASHBOARD_LIMIT = 5;

/**
 * Startsidans "Att bevaka". Visar de mest brådskande posterna och länkar
 * vidare — kortet ska tala om ATT något behöver uppmärksamhet, inte ersätta
 * hela listan. Self-gating: har man inget att bevaka renderas ingenting, så
 * kortet aldrig blir tomt utfyllnad.
 */
function WatchlistCard() {
  const q = trpc.watchlist.list.useQuery({ mine: true });
  const complete = useCompleteWatch();
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;

  const passed = items.filter((i) => i.severity === "passed").length;
  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-6">
      <div className={sectionHeaderClass("amber")}>
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          🔔 Att bevaka
          <span className="text-xs font-normal text-gray-500">
            ({items.length}{passed > 0 ? `, ${passed} passerade` : ""})
          </span>
        </h2>
        <Link href="/watchlist" className="text-sm text-blue-600 hover:underline">
          Visa alla →
        </Link>
      </div>
      <div className="p-4">
        <WatchlistList items={items.slice(0, DASHBOARD_LIMIT)} emptyText="" onComplete={complete} />
      </div>
    </div>
  );
}

function DaySwitcher({ ymd, onChange }: { ymd: string; onChange: (y: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex rounded-md border border-gray-200 bg-white text-xs">
        {[
          { label: "Igår", v: offsetDayYmd(1) },
          { label: "Idag", v: todayYmd() },
          { label: "Imorgon", v: offsetDayYmd(-1) },
        ].map((b) => (
          <button key={b.v} type="button" onClick={() => onChange(b.v)}
            className={`px-3 py-1.5 ${ymd === b.v ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}>
            {b.label}
          </button>
        ))}
      </div>
      <input type="date" value={ymd} onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gray-200 px-2 py-1 text-xs" />
    </div>
  );
}

/**
 * Dagens kalender (#1167): möten och förhandlingar. Uppgifter och frister
 * står i "Att bevaka" — förr visade det här kortet ("Att göra") samma
 * poster en gång till, och två listor med samma innehåll förvirrade.
 */
function CalendarCard({ ymd }: { ymd: string }) {
  const range = useMemo(() => rangeForDay(ymd), [ymd]);
  // Vänta på me.data innan vi frågar — todo.list verifierar att user finns
  // i org:en. Demo-runtime hydrerar users asynkront → utan gate kraschar
  // första query:n innan datan finns.
  const me = trpc.user.current.useQuery();
  const todo = trpc.todo.list.useQuery(
    { from: range.from, to: range.to },
    { enabled: !!me.data?.id },
  );
  const events = todo.data?.filter((i) => i.source === "event") as CalendarItem[] | undefined;
  const [selected, setSelected] = useState<CalendarItem | null>(null);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className={sectionHeaderClass("blue")}>
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <CalendarIcon size={16} className="text-gray-500" /> Kalender
          {events && <span className="text-xs font-normal text-gray-500">({events.length})</span>}
        </h2>
        <Link href="/calendar" className="text-sm text-blue-600 hover:underline">Öppna kalender →</Link>
      </div>
      <CalendarList events={events} isLoading={todo.isLoading} ymd={ymd} onSelect={setSelected} />
      <Modal open={!!selected} title={selected?.title ?? ""} onClose={() => setSelected(null)} widthClass="max-w-lg">
        {selected && <CalendarDetail item={selected} onClose={() => setSelected(null)} />}
      </Modal>
    </div>
  );
}

/** Listinnehållet: laddar / tomt / rader. */
function CalendarList({ events, isLoading, ymd, onSelect }: {
  events: CalendarItem[] | undefined; isLoading: boolean; ymd: string; onSelect: (i: CalendarItem) => void;
}) {
  return (
    <div className="divide-y divide-gray-100">
      {isLoading && <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>}
      {events && events.length === 0 && (
        <p className="px-6 py-4 text-sm text-gray-500">Inget i kalendern {ymd === todayYmd() ? "idag" : "denna dag"}.</p>
      )}
      {events?.map((item) => <CalendarRow key={item.id} item={item} onSelect={onSelect} />)}
    </div>
  );
}

interface CalendarItem {
  id: string;
  title: string;
  at: string | Date;
  endAt?: string | Date | null;
  allDay: boolean;
  kind: string | null;
  location: string | null;
  description?: string | null;
  matter: { id: string; matterNumber: string; title: string } | null;
}

function badgeFor(item: CalendarItem): { cls: string; label: string } {
  if (item.kind === "deadline") return { cls: "bg-amber-100 text-amber-800", label: "Frist" };
  return { cls: "bg-purple-50 text-purple-700", label: "Möte" };
}

function CalendarRow({ item, onSelect }: { item: CalendarItem; onSelect: (item: CalendarItem) => void }) {
  const date = new Date(item.at);
  const timeStr = item.allDay ? "Hela dagen" : date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const badge = badgeFor(item);
  return (
    <button type="button" onClick={() => onSelect(item)}
      className="w-full text-left px-6 py-3 hover:bg-gray-50 flex items-center gap-3">
      <span className={`inline-flex text-[10px] font-medium uppercase rounded-full px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
        {item.matter && (
          <p className="text-xs text-gray-500 truncate">{item.matter.matterNumber} — {item.matter.title}</p>
        )}
      </div>
      <span className="text-xs text-gray-500 whitespace-nowrap">{timeStr}</span>
    </button>
  );
}

/** Detaljer för en kalenderpost (läsvy). */
function CalendarDetail({ item, onClose }: { item: CalendarItem; onClose: () => void }) {
  const badge = badgeFor(item);
  return (
    <div className="space-y-3 text-sm">
      <span className={`inline-flex text-[10px] font-medium uppercase rounded-full px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
      <DetailWhen item={item} />
      {item.location && (
        <p className="text-gray-700 inline-flex items-center gap-1"><MapPin size={12} className="text-gray-400" /> {item.location}</p>
      )}
      {item.description && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Beskrivning</p>
          <p className="text-gray-700 whitespace-pre-wrap">{item.description}</p>
        </div>
      )}
      {item.matter && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Ärende</p>
          <EntityLink route="matters" id={item.matter.id} className="text-blue-600 hover:underline">
            {item.matter.matterNumber} — {item.matter.title}
          </EntityLink>
        </div>
      )}
      <div className="flex justify-end pt-3 border-t border-gray-200">
        <button type="button" onClick={onClose}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Stäng
        </button>
      </div>
    </div>
  );
}

/** Datum + tid (+ ev. sluttid). */
function DetailWhen({ item }: { item: CalendarItem }) {
  const date = new Date(item.at);
  const dateStr = date.toLocaleDateString("sv-SE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = item.allDay ? "Hela dagen" : date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const endStr = item.endAt && !item.allDay ? new Date(item.endAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <p className="text-gray-700"><span className="capitalize">{dateStr}</span>{!item.allDay && <> · {timeStr}{endStr ? `–${endStr}` : ""}</>}</p>
  );
}

interface TimeEntryRow { id: string; minutes: number; description: string; billable: boolean; matter: { id: string; matterNumber: string; title: string } }
interface TimeQueryLike { data?: { entries: TimeEntryRow[]; totalMinutes: number } | undefined; isLoading: boolean }

function TimeCard({ ymd }: { ymd: string }) {
  const range = useMemo(() => rangeForDay(ymd), [ymd]);
  const me = trpc.user.current.useQuery();
  const entries = trpc.timeEntry.list.useQuery(
    { userId: me.data?.id, from: range.from, to: range.to, pageSize: 50 },
    { enabled: !!me.data?.id },
  ) as TimeQueryLike;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className={sectionHeaderClass("indigo")}>
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Clock size={16} className="text-gray-500" /> Tidrapportering
          {entries.data && (
            <span className="text-xs font-normal text-gray-500">({formatMinutes(entries.data.totalMinutes)})</span>
          )}
        </h2>
        <Link href="/time" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
          <Plus size={12} /> Ny tid
        </Link>
      </div>
      <TimeList entries={entries} ymd={ymd} />
    </div>
  );
}

/** Tidslistan: laddar / tomt / rader. */
function TimeList({ entries, ymd }: { entries: TimeQueryLike; ymd: string }) {
  return (
    <div className="divide-y divide-gray-100">
      {entries.isLoading && <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>}
      {entries.data && entries.data.entries.length === 0 && (
        <p className="px-6 py-4 text-sm text-gray-500">Ingen tid registrerad {ymd === todayYmd() ? "idag" : "denna dag"} — <Link href="/time" className="text-blue-600 hover:underline">registrera tid</Link></p>
      )}
      {entries.data?.entries.map((e) => (
        <EntityLink key={e.id} route="matters" id={e.matter.id}
          className="block px-6 py-3 hover:bg-gray-50 flex items-center gap-3">
          <span className="text-sm font-mono text-gray-700 w-14 text-right">{formatMinutes(e.minutes)}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900 truncate">{e.description}</p>
            <p className="text-xs text-gray-500 truncate">{e.matter.matterNumber} — {e.matter.title}</p>
          </div>
          {!e.billable && <span className="text-[10px] text-gray-400 uppercase">Ej deb.</span>}
        </EntityLink>
      ))}
    </div>
  );
}

function RecentMattersCard() {
  const me = trpc.user.current.useQuery();
  // Senaste 50 tidsposter, sortera bort till unika ärenden, ta första 5.
  const entries = trpc.timeEntry.list.useQuery(
    { userId: me.data?.id, pageSize: 50 },
    { enabled: !!me.data?.id },
  );
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; matterNumber: string; title: string; lastDate: Date }> = [];
    for (const e of entries.data?.entries ?? []) {
      if (seen.has(e.matter.id)) continue;
      seen.add(e.matter.id);
      out.push({ id: e.matter.id, matterNumber: e.matter.matterNumber, title: e.matter.title, lastDate: new Date(e.date) });
      if (out.length >= 5) break;
    }
    return out;
  }, [entries.data]);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className={sectionHeaderClass("gray")}>
        <h2 className="font-semibold text-gray-900">Senaste ärenden du jobbat i</h2>
        <Link href="/matters" className="text-sm text-blue-600 hover:underline">Alla ärenden →</Link>
      </div>
      <div className="divide-y divide-gray-100">
        {entries.isLoading && <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>}
        {entries.data && recent.length === 0 && (
          <p className="px-6 py-4 text-sm text-gray-500">Du har inte registrerat tid på något ärende ännu.</p>
        )}
        {recent.map((m) => (
          <EntityLink key={m.id} route="matters" id={m.id} className="block px-6 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{m.matterNumber} — {m.title}</p>
              <p className="text-xs text-gray-500">Senast: {m.lastDate.toLocaleDateString("sv-SE")}</p>
            </div>
          </EntityLink>
        ))}
      </div>
    </div>
  );
}
