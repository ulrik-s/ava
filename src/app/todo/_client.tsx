"use client";

/**
 * `TodoClient` — enad Att-göra-vy (tasks + calendar-events tidsordnade).
 *
 * Funktioner i denna MVP:
 *   - Dag-väljare: Igår / Idag / Imorgon + datum-input.
 *   - User-väljare: visa annan kollegas att-göra-lista (sjukdoms-täckning).
 *   - Visar tid, typ-ikon, titel, ärende, status (för tasks) / plats (för events).
 *
 * Nästa steg (separata commits): kolumn-sortering/-bredd/-ordning per user
 * (kommer som del av den övergripande kolumn-pref-featuren).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, CheckSquare, Clock, MapPin } from "lucide-react";
import { trpc } from "@/lib/client/trpc";

const TASK_STATUS_LABELS: Record<string, string> = { TODO: "Att göra", IN_PROGRESS: "Pågår", DONE: "Klar" };
const EVENT_KIND_LABELS: Record<string, string> = { appointment: "Möte", deadline: "Frist" };

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function toInputDate(d: Date): string { return d.toISOString().slice(0, 10); }
function fromInputDate(s: string): Date { const [y, m, day] = s.split("-").map(Number); return new Date(y, (m ?? 1) - 1, day ?? 1); }
function shiftDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export default function TodoClient() {
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [userId, setUserId] = useState<string>("");

  const users = trpc.user.list.useQuery();
  const me = trpc.user.current.useQuery();
  const effectiveUserId = userId || me.data?.id;

  const range = useMemo(() => ({ from: startOfDay(day), to: endOfDay(day) }), [day]);
  const items = trpc.todo.list.useQuery(
    { from: range.from, to: range.to, ...(effectiveUserId ? { userId: effectiveUserId } : {}) },
    { enabled: !!effectiveUserId },
  );

  const dayLabel = day.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Att göra <span className="ml-2 text-base font-normal text-gray-500">{dayLabel}</span></h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setDay((d) => shiftDays(d, -1))} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">← Igår</button>
          <button onClick={() => setDay(startOfDay(new Date()))} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">Idag</button>
          <button onClick={() => setDay((d) => shiftDays(d, 1))} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">Imorgon →</button>
          <input
            type="date"
            value={toInputDate(day)}
            onChange={(e) => setDay(startOfDay(fromInputDate(e.target.value)))}
            className="px-2 py-1.5 text-sm border rounded"
          />
        </div>
      </header>

      <div className="flex items-center gap-2 text-sm">
        <label className="text-gray-600">Visa för:</label>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className="px-2 py-1 border rounded">
          <option value="">Mig själv</option>
          {(users.data?.users ?? []).map((u: { id: string; name: string }) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>

      <TodoList items={items.data ?? []} isLoading={items.isLoading} />
    </div>
  );
}

interface TodoRow {
  id: string;
  source: "task" | "event";
  title: string;
  at: string | Date;
  endAt: string | Date | null;
  allDay: boolean;
  status: string | null;
  kind: string | null;
  location: string | null;
  matter: { id: string; matterNumber: string; title: string } | null;
}

function TodoList({ items, isLoading }: { items: TodoRow[]; isLoading: boolean }) {
  if (isLoading) return <p className="text-sm text-gray-400">Laddar…</p>;
  if (items.length === 0) return <p className="text-sm text-gray-500">Inget på agendan denna dag.</p>;

  return (
    <ul className="divide-y divide-gray-200 bg-white border border-gray-200 rounded-lg overflow-hidden">
      {items.map((it) => <TodoLi key={`${it.source}-${it.id}`} it={it} />)}
    </ul>
  );
}

function fmtTime(d: Date): string { return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }); }

function timeLabelFor(it: TodoRow): string {
  if (it.allDay) return "Heldag";
  const start = new Date(it.at);
  if (it.endAt) return `${fmtTime(start)}–${fmtTime(new Date(it.endAt))}`;
  return fmtTime(start);
}

function tagFor(it: TodoRow): string {
  if (it.source === "task") return it.status ? TASK_STATUS_LABELS[it.status] ?? it.status : "Att göra";
  return it.kind ? EVENT_KIND_LABELS[it.kind] ?? it.kind : "Händelse";
}

function TodoIcon({ it }: { it: TodoRow }) {
  if (it.source === "task") return <CheckSquare size={16} className="text-gray-400 shrink-0" />;
  if (it.kind === "deadline") return <Clock size={16} className="text-gray-400 shrink-0" />;
  return <Calendar size={16} className="text-gray-400 shrink-0" />;
}

function TodoLi({ it }: { it: TodoRow }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
      <TodoIcon it={it} />
      <span className="font-mono text-xs text-gray-500 w-28 shrink-0">{timeLabelFor(it)}</span>
      <span className="flex-1 min-w-0 truncate">{it.title}</span>
      {it.location && (
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-500"><MapPin size={11} /> {it.location}</span>
      )}
      {it.matter && (
        <Link href={`/matters/${it.matter.id}`} className="text-xs text-blue-600 hover:underline truncate max-w-[12rem]" title={it.matter.title}>
          {it.matter.matterNumber}
        </Link>
      )}
      <span className="text-[10px] rounded-full bg-gray-100 text-gray-700 px-2 py-0.5">{tagFor(it)}</span>
    </li>
  );
}
