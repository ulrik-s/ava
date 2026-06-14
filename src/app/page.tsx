"use client";

/**
 * Dashboard — översikt för inloggad användare:
 *   - "Att göra" för vald dag (tasks + events)
 *   - Tidrapportering för vald dag (summa + lista)
 *   - Senaste 5 ärenden man jobbat i (timeEntry order desc, dedup)
 *
 * Dagsval: Igår / Idag / Imorgon / fritt datum.
 */

import { Plus, Calendar as CalendarIcon, Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
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

// eslint-disable-next-line complexity -- många JSX-conditionals + modal
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
  const [selected, setSelected] = useState<TodoItem | null>(null);
  const utils = trpc.useUtils();
  const completeTask = trpc.task.complete.useMutation({ onSuccess: () => utils.todo.list.invalidate() });
  const updateTask = trpc.task.update.useMutation({ onSuccess: () => utils.todo.list.invalidate() });

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
          <TodoRow key={`${item.source}-${item.id}`} item={item as TodoItem} onSelect={setSelected} />
        ))}
      </div>

      <Modal open={!!selected} title={selected?.title ?? ""} onClose={() => setSelected(null)} widthClass="max-w-lg">
        {selected && (
          <TodoDetailCard
            item={selected}
            isOwn={!!me.data?.id && selected.userId === me.data.id}
            onToggleDone={() => {
              if (selected.status === "DONE") {
                updateTask.mutate({ id: selected.id, status: "TODO" });
              } else {
                completeTask.mutate({ id: selected.id });
              }
              setSelected(null);
            }}
            onClose={() => setSelected(null)}
          />
        )}
      </Modal>
    </div>
  );
}

interface TodoItem {
  id: string;
  source: "task" | "event";
  title: string;
  at: string | Date;
  endAt?: string | Date | null;
  allDay: boolean;
  status: string | null;
  priority: string | null;
  kind: string | null;
  location: string | null;
  description?: string | null;
  userId: string;
  matter: { id: string; matterNumber: string; title: string } | null;
}

function badgeFor(item: TodoItem): { cls: string; label: string } {
  if (item.source === "task") return { cls: "bg-blue-50 text-blue-700", label: "Att göra" };
  if (item.kind === "deadline") return { cls: "bg-amber-100 text-amber-800", label: "Frist" };
  return { cls: "bg-purple-50 text-purple-700", label: "Möte" };
}

function TodoRow({ item, onSelect }: { item: TodoItem; onSelect: (item: TodoItem) => void }) {
  const date = new Date(item.at);
  const timeStr = item.allDay ? "Hela dagen" : date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const badge = badgeFor(item);
  const isDone = item.source === "task" && item.status === "DONE";
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full text-left px-6 py-3 hover:bg-gray-50 flex items-center gap-3 ${isDone ? "opacity-60" : ""}`}
    >
      <span className={`inline-flex text-[10px] font-medium uppercase rounded-full px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium text-gray-900 truncate ${isDone ? "line-through" : ""}`}>{item.title}</p>
        {item.matter && (
          <p className="text-xs text-gray-500 truncate">{item.matter.matterNumber} — {item.matter.title}</p>
        )}
      </div>
      <span className="text-xs text-gray-500 whitespace-nowrap">{timeStr}</span>
    </button>
  );
}

const PRIORITY_LABELS: Record<string, string> = { LOW: "Låg", MEDIUM: "Medium", HIGH: "Hög" };
const STATUS_LABELS: Record<string, string> = { TODO: "Att göra", IN_PROGRESS: "Pågår", DONE: "Klar" };

// eslint-disable-next-line complexity -- många JSX-conditional-rader (status/prioritet/plats/beskrivning/ärende/own-actions)
function TodoDetailCard({ item, isOwn, onToggleDone, onClose }: {
  item: TodoItem;
  isOwn: boolean;
  onToggleDone: () => void;
  onClose: () => void;
}) {
  const date = new Date(item.at);
  const dateStr = date.toLocaleDateString("sv-SE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = item.allDay ? "Hela dagen" : date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const endStr = item.endAt && !item.allDay ? new Date(item.endAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) : null;
  const badge = badgeFor(item);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className={`inline-flex text-[10px] font-medium uppercase rounded-full px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
        {item.source === "task" && item.status && (
          <span className="text-xs text-gray-600">{STATUS_LABELS[item.status] ?? item.status}</span>
        )}
        {item.source === "task" && item.priority && (
          <span className="text-xs text-gray-600">· Prioritet: {PRIORITY_LABELS[item.priority] ?? item.priority}</span>
        )}
      </div>

      <p className="text-gray-700"><span className="capitalize">{dateStr}</span>{!item.allDay && <> · {timeStr}{endStr ? `–${endStr}` : ""}</>}</p>

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

      <div className="flex justify-between gap-2 pt-3 border-t border-gray-200">
        <div>
          {isOwn && item.source === "task" && (
            <button type="button" onClick={onToggleDone}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">
              {item.status === "DONE" ? "Markera ej klar" : "Markera klar"}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {isOwn && item.source === "task" && (
            <Link href="/todo" onClick={onClose}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
              Ändra…
            </Link>
          )}
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Stäng
          </button>
        </div>
      </div>
    </div>
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
