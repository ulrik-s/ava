"use client";

/**
 * /calendar — användarens kalender (möten, förhandlingar, frister) + tasks.
 *
 * V1: enkel listvy + create-form. Månads-/veckovy kommer i Phase E.
 * Outlook-spegling (mirror-to-outlook-worker) kommer i Phase D.
 */

import { useState } from "react";
import { trpc } from "@/client/lib/trpc";
import { Calendar as CalendarIcon, Plus, ExternalLink, Trash2, CheckCircle2 } from "lucide-react";

export default function CalendarPage() {
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CalendarIcon size={24} /> Kalender
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Möten, förhandlingar, frister och tasks. Markera valfria events
          för spegling till Outlook.
        </p>
      </div>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Kommande events</h2>
          <button
            onClick={() => setShowNewEvent((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            <Plus size={14} /> Nytt event
          </button>
        </div>
        {showNewEvent && <NewEventForm onClose={() => setShowNewEvent(false)} />}
        <EventList />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Tasks</h2>
          <button
            onClick={() => setShowNewTask((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            <Plus size={14} /> Ny task
          </button>
        </div>
        {showNewTask && <NewTaskForm onClose={() => setShowNewTask(false)} />}
        <TaskList />
      </section>
    </div>
  );
}

// ─── Event-list ───────────────────────────────────────────────────────────

function EventList() {
  const { data: events, isLoading } = trpc.calendar.list.useQuery();
  const utils = trpc.useUtils();
  const del = trpc.calendar.delete.useMutation({ onSuccess: () => utils.calendar.list.invalidate() });

  if (isLoading) return <p className="text-sm text-gray-500">Laddar…</p>;
  if (!events?.length) return <p className="text-sm text-gray-400 italic">Inga events ännu.</p>;

  return (
    <ul className="divide-y divide-gray-100 bg-white rounded-lg border border-gray-200">
      {events.map((ev: EventRow) => (
        <li key={ev.id} className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">{ev.title}</span>
              <KindBadge kind={ev.kind} />
              {ev.mirrorToOutlook && <MirrorBadge status={ev.mirrorStatus} />}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatEventTime(ev)}
              {ev.location ? ` · ${ev.location}` : ""}
              {ev.matter ? ` · ${ev.matter.matterNumber}` : ""}
            </p>
          </div>
          <button
            onClick={() => { if (confirm(`Ta bort "${ev.title}"?`)) del.mutate({ id: ev.id }); }}
            className="text-gray-400 hover:text-red-600 p-1"
            title="Ta bort"
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Task-list ────────────────────────────────────────────────────────────

function TaskList() {
  const { data: tasks, isLoading } = trpc.task.list.useQuery();
  const utils = trpc.useUtils();
  const complete = trpc.task.complete.useMutation({ onSuccess: () => utils.task.list.invalidate() });
  const del = trpc.task.delete.useMutation({ onSuccess: () => utils.task.list.invalidate() });

  if (isLoading) return <p className="text-sm text-gray-500">Laddar…</p>;
  if (!tasks?.length) return <p className="text-sm text-gray-400 italic">Inga tasks ännu.</p>;

  return (
    <ul className="divide-y divide-gray-100 bg-white rounded-lg border border-gray-200">
      {tasks.map((t: TaskRow) => (
        <li key={t.id} className={`px-4 py-3 flex items-center justify-between gap-3 ${t.status === "DONE" ? "opacity-60" : ""}`}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${t.status === "DONE" ? "line-through text-gray-500" : "text-gray-900"}`}>
                {t.title}
              </span>
              <PriorityBadge priority={t.priority} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {t.dueAt ? `Förfaller ${new Date(t.dueAt).toLocaleDateString("sv-SE")}` : "Ingen deadline"}
              {t.matter ? ` · ${t.matter.matterNumber}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {t.status !== "DONE" && (
              <button
                onClick={() => complete.mutate({ id: t.id })}
                className="text-gray-400 hover:text-green-600 p-1"
                title="Markera klar"
              >
                <CheckCircle2 size={16} />
              </button>
            )}
            <button
              onClick={() => { if (confirm(`Ta bort "${t.title}"?`)) del.mutate({ id: t.id }); }}
              className="text-gray-400 hover:text-red-600 p-1"
              title="Ta bort"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Create forms ─────────────────────────────────────────────────────────

function NewEventForm({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const create = trpc.calendar.create.useMutation({
    onSuccess: () => {
      utils.calendar.list.invalidate();
      onClose();
    },
  });
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"appointment" | "deadline">("appointment");
  const [startAt, setStartAt] = useState(new Date().toISOString().slice(0, 16));
  const [endAt, setEndAt] = useState("");
  const [location, setLocation] = useState("");
  const [mirrorToOutlook, setMirrorToOutlook] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      title,
      kind,
      startAt: new Date(startAt),
      endAt: endAt && kind === "appointment" ? new Date(endAt) : undefined,
      location: location || undefined,
      mirrorToOutlook,
    });
  };

  return (
    <form onSubmit={submit} className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2">
          <span className="text-xs text-gray-600 mb-1 block">Titel *</span>
          <input
            type="text" required value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Typ</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as "appointment" | "deadline")}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
            <option value="appointment">Möte / Förhandling</option>
            <option value="deadline">Frist</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Plats</span>
          <input
            type="text" value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Stockholms tingsrätt, sal 5"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Start *</span>
          <input
            type="datetime-local" required value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        {kind === "appointment" && (
          <label className="block">
            <span className="text-xs text-gray-600 mb-1 block">Slut</span>
            <input
              type="datetime-local" value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-700">
        <input
          type="checkbox" checked={mirrorToOutlook}
          onChange={(e) => setMirrorToOutlook(e.target.checked)}
        />
        <ExternalLink size={12} /> Spegla till Outlook (kräver O365-anslutning)
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 hover:bg-white rounded">Avbryt</button>
        <button type="submit" disabled={!title || create.isPending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {create.isPending ? "Sparar…" : "Skapa"}
        </button>
      </div>
    </form>
  );
}

function NewTaskForm({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const create = trpc.task.create.useMutation({
    onSuccess: () => { utils.task.list.invalidate(); onClose(); },
  });
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [dueAt, setDueAt] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      title,
      priority,
      dueAt: dueAt ? new Date(dueAt) : undefined,
    });
  };

  return (
    <form onSubmit={submit} className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <label className="block col-span-3">
          <span className="text-xs text-gray-600 mb-1 block">Titel *</span>
          <input
            type="text" required value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Prioritet</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as "LOW" | "MEDIUM" | "HIGH")}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
            <option value="LOW">Låg</option>
            <option value="MEDIUM">Medel</option>
            <option value="HIGH">Hög</option>
          </select>
        </label>
        <label className="block col-span-2">
          <span className="text-xs text-gray-600 mb-1 block">Förfaller</span>
          <input
            type="date" value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 hover:bg-white rounded">Avbryt</button>
        <button type="submit" disabled={!title || create.isPending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {create.isPending ? "Sparar…" : "Skapa"}
        </button>
      </div>
    </form>
  );
}

// ─── Badges + helpers ─────────────────────────────────────────────────────

interface EventRow {
  id: string;
  title: string;
  kind: "appointment" | "deadline";
  startAt: string | Date;
  endAt?: string | Date | null;
  allDay: boolean;
  location?: string | null;
  matter?: { id: string; matterNumber: string; title: string } | null;
  mirrorToOutlook?: boolean;
  mirrorStatus?: "pending" | "synced" | "failed" | null;
}

interface TaskRow {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  dueAt?: string | Date | null;
  matter?: { id: string; matterNumber: string; title: string } | null;
}

function KindBadge({ kind }: { kind: "appointment" | "deadline" }) {
  const styles = kind === "appointment"
    ? "bg-blue-100 text-blue-800"
    : "bg-amber-100 text-amber-800";
  return (
    <span className={`text-[10px] uppercase font-medium rounded px-1.5 py-0.5 ${styles}`}>
      {kind === "appointment" ? "Möte" : "Frist"}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: "LOW" | "MEDIUM" | "HIGH" }) {
  const styles: Record<string, string> = {
    HIGH: "bg-red-100 text-red-800",
    MEDIUM: "bg-yellow-100 text-yellow-800",
    LOW: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`text-[10px] uppercase font-medium rounded px-1.5 py-0.5 ${styles[priority]}`}>
      {priority === "HIGH" ? "Hög" : priority === "MEDIUM" ? "Medel" : "Låg"}
    </span>
  );
}

function MirrorBadge({ status }: { status?: "pending" | "synced" | "failed" | null }) {
  const text = status === "synced" ? "Outlook ✓" : status === "failed" ? "Outlook ✗" : "Outlook ⏳";
  const styles = status === "synced"
    ? "bg-green-100 text-green-800"
    : status === "failed"
    ? "bg-red-100 text-red-800"
    : "bg-gray-100 text-gray-600";
  return (
    <span className={`text-[10px] uppercase font-medium rounded px-1.5 py-0.5 ${styles}`}>
      {text}
    </span>
  );
}

function formatEventTime(ev: EventRow): string {
  const start = new Date(ev.startAt);
  const opts: Intl.DateTimeFormatOptions = ev.allDay
    ? { year: "numeric", month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  const startStr = start.toLocaleString("sv-SE", opts);
  if (ev.kind === "deadline" || !ev.endAt) return startStr;
  const end = new Date(ev.endAt);
  return `${startStr} → ${end.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`;
}
