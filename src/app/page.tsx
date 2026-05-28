"use client";

/**
 * Dashboard — översikt för inloggad användare:
 *   - "Att göra" för vald dag (tasks + events)
 *   - Tidrapportering för vald dag (summa + lista)
 *   - Senaste 5 ärenden man jobbat i (timeEntry order desc, dedup)
 *
 * Dagsval: Idag / Igår / Förrgår / fritt datum.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";
import { Plus, Calendar as CalendarIcon, Clock } from "lucide-react";

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
  if (ymd === offsetDayYmd(2)) return "Förrgår";
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("sv-SE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export default function Dashboard() {
  const [ymd, setYmd] = useState<string>(todayYmd());

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 capitalize">{dayLabel(ymd)}</p>
        </div>
        <DaySwitcher ymd={ymd} onChange={setYmd} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <TodoCard ymd={ymd} />
        <TimeCard ymd={ymd} />
      </div>

      <RecentMattersCard />
    </div>
  );
}

function DaySwitcher({ ymd, onChange }: { ymd: string; onChange: (y: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex rounded-md border border-gray-200 bg-white text-xs">
        {[
          { label: "Förrgår", v: offsetDayYmd(2) },
          { label: "Igår", v: offsetDayYmd(1) },
          { label: "Idag", v: todayYmd() },
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

function TodoCard({ ymd }: { ymd: string }) {
  const range = useMemo(() => rangeForDay(ymd), [ymd]);
  // Vänta på me.data innan vi frågar — todo.list verifierar att user finns
  // i org:en. Demo-runtime hydrerar users asynkront → utan gate kraschar
  // första query:n innan datan finns.
  const me = trpc.user.current.useQuery();
  const todo = trpc.todo.list.useQuery(
    { from: range.from, to: range.to },
    { enabled: !!me.data?.id },
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <CalendarIcon size={16} className="text-gray-500" /> Att göra
          {todo.data && <span className="text-xs font-normal text-gray-500">({todo.data.length})</span>}
        </h2>
        <Link href="/todo" className="text-sm text-blue-600 hover:underline">Öppna alla →</Link>
      </div>
      <div className="divide-y divide-gray-100">
        {todo.isLoading && <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>}
        {todo.data && todo.data.length === 0 && (
          <p className="px-6 py-4 text-sm text-gray-500">Inget att göra {ymd === todayYmd() ? "idag" : "denna dag"}.</p>
        )}
        {todo.data?.map((item) => (
          <TodoRow key={`${item.source}-${item.id}`} item={item} />
        ))}
      </div>
    </div>
  );
}

interface TodoItem {
  id: string;
  source: "task" | "event";
  title: string;
  at: string | Date;
  allDay: boolean;
  status: string | null;
  kind: string | null;
  matter: { id: string; matterNumber: string; title: string } | null;
}

function TodoRow({ item }: { item: TodoItem }) {
  const date = new Date(item.at);
  const timeStr = item.allDay ? "Hela dagen" : date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const inner = (
    <div className="px-6 py-3 hover:bg-gray-50 flex items-center gap-3">
      <span className={`inline-flex text-[10px] font-medium uppercase rounded-full px-1.5 py-0.5 ${
        item.source === "task" ? "bg-blue-50 text-blue-700"
          : item.kind === "deadline" ? "bg-amber-100 text-amber-800"
          : "bg-purple-50 text-purple-700"
      }`}>
        {item.source === "task" ? "Att göra" : item.kind === "deadline" ? "Frist" : "Möte"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
        {item.matter && (
          <p className="text-xs text-gray-500 truncate">{item.matter.matterNumber} — {item.matter.title}</p>
        )}
      </div>
      <span className="text-xs text-gray-500 whitespace-nowrap">{timeStr}</span>
    </div>
  );
  return item.matter ? (
    <Link href={`/matters/${item.matter.id}`} className="block">{inner}</Link>
  ) : (
    <div>{inner}</div>
  );
}

// eslint-disable-next-line complexity -- JSX-conditionals (laddar/tomt/lista)
function TimeCard({ ymd }: { ymd: string }) {
  const range = useMemo(() => rangeForDay(ymd), [ymd]);
  const me = trpc.user.current.useQuery();
  const entries = trpc.timeEntry.list.useQuery(
    { userId: me.data?.id, from: range.from, to: range.to, pageSize: 50 },
    { enabled: !!me.data?.id },
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
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
      <div className="divide-y divide-gray-100">
        {entries.isLoading && <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>}
        {entries.data && entries.data.entries.length === 0 && (
          <p className="px-6 py-4 text-sm text-gray-500">Ingen tid registrerad {ymd === todayYmd() ? "idag" : "denna dag"} — <Link href="/time" className="text-blue-600 hover:underline">registrera tid</Link></p>
        )}
        {entries.data?.entries.map((e) => (
          <Link key={e.id} href={`/matters/${e.matter.id}`}
            className="block px-6 py-3 hover:bg-gray-50 flex items-center gap-3">
            <span className="text-sm font-mono text-gray-700 w-14 text-right">{formatMinutes(e.minutes)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-900 truncate">{e.description}</p>
              <p className="text-xs text-gray-500 truncate">{e.matter.matterNumber} — {e.matter.title}</p>
            </div>
            {!e.billable && <span className="text-[10px] text-gray-400 uppercase">Ej deb.</span>}
          </Link>
        ))}
      </div>
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
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Senaste ärenden du jobbat i</h2>
        <Link href="/matters" className="text-sm text-blue-600 hover:underline">Alla ärenden →</Link>
      </div>
      <div className="divide-y divide-gray-100">
        {entries.isLoading && <p className="px-6 py-3 text-sm text-gray-500">Laddar…</p>}
        {entries.data && recent.length === 0 && (
          <p className="px-6 py-4 text-sm text-gray-500">Du har inte registrerat tid på något ärende ännu.</p>
        )}
        {recent.map((m) => (
          <Link key={m.id} href={`/matters/${m.id}`} className="block px-6 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{m.matterNumber} — {m.title}</p>
              <p className="text-xs text-gray-500">Senast: {m.lastDate.toLocaleDateString("sv-SE")}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
