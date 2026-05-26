"use client";

/**
 * /calendar — användarens kalender (möten, förhandlingar, frister) + tasks.
 *
 * Vy: lista nu — månadsgrid och veckovy i CalendarGrid-komponenten.
 * Outlook-spegling enqueue:as automatiskt på create/update/delete via
 * `enqueueMirror()` när `mirrorToOutlook=true`.
 */

import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/client/trpc";
import { Calendar as CalendarIcon, Plus, ExternalLink, Trash2, CheckCircle2, List, LayoutGrid, CalendarDays, Sun } from "lucide-react";
import { jobQueue } from "@/lib/client/jobs/job-queue";
import { CalendarGrid, startOfDay } from "./_calendar-grid";
import { DayView } from "./_day-view";
import { EventDetailModal, type EventDetail } from "./_event-detail-modal";
import { MatterCombobox } from "@/components/matter/matter-combobox";
import { UserPicker, loadSelectedUserIds } from "./_user-picker";
import { buildUserColorMap, type UserColor } from "@/lib/client/calendar/user-colors";

type ViewMode = "list" | "day" | "week" | "month";

interface EventForMirror {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt?: string | null;
  allDay: boolean;
  visibility: "normal" | "private";
  kind: "appointment" | "deadline";
}

interface MirrorArgs {
  eventId: string;
  op: "upsert" | "delete";
  event?: EventForMirror;
  outlookEventId?: string | null;
  outlookCalendarId?: string | null;
}

/**
 * Enqueue:a en mirror-to-outlook-worker. Fire-and-forget; workern
 * uppdaterar mirrorStatus efter sync och calendar.list invalidate:as.
 */
function enqueueMirror(args: MirrorArgs): void {
  const label = args.op === "delete"
    ? `Tar bort i Outlook: ${args.eventId.slice(0, 8)}`
    : `Speglar till Outlook: ${args.event?.title ?? ""}`;
  jobQueue.enqueue("mirror-to-outlook", label, args as unknown as Record<string, unknown>);
}

// eslint-disable-next-line complexity
export default function CalendarPage() {
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [view, setView] = useState<ViewMode>("week");
  const [selectedEvent, setSelectedEvent] = useState<EventDetail | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);
  // Hydration-safe init: `new Date()` och `localStorage` ger olika värden
  // SSR (statisk export, byggtid) vs klient. Vi initialiserar deterministiskt
  // till null/[] och fyller via useEffect efter mount — då matchar SSR-HTML
  // klientens första render.
  const [anchor, setAnchor] = useState<Date | null>(null);
   
  useEffect(() => {
    // Acceptera ?date=YYYY-MM-DD så andra sidor kan länka hit och hoppa
    // direkt till en specifik dag (matter-detalj: "Gå till kalendern").
    const url = new URL(window.location.href);
    const dateParam = url.searchParams.get("date");
    const parsed = dateParam ? new Date(dateParam) : null;
    const valid = parsed && !isNaN(parsed.getTime()) ? parsed : new Date();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnchor(startOfDay(valid));
     
    if (dateParam) setView("day");
  }, []);

  // Persistera vilka användare som visas (multi-user). Default: bara mig.
  const currentUser = trpc.user.current.useQuery();
  const orgUsers = trpc.user.list.useQuery();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  useEffect(() => {
    // Läs localStorage först efter mount så SSR-HTML inte missmatchar.
    const stored = loadSelectedUserIds();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored.length > 0) setSelectedUserIds(stored);
  }, []);

  // När current-user laddats: om inget val finns sen tidigare → välj bara mig.
  useEffect(() => {
    if (selectedUserIds.length === 0 && currentUser.data?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedUserIds([currentUser.data.id]);
    }
  }, [currentUser.data?.id, selectedUserIds.length]);

  const userNames = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const u of orgUsers.data?.users ?? []) m[u.id] = u.name;
    return m;
  }, [orgUsers.data?.users]);

  // Färgmappen byggs över ALLA org-användare så färgerna är stabila även
  // när man togglar in/ut individer i pickern. `buildUserColorMap` sorterar
  // id:na deterministiskt och garanterar unika färger för ≤12 användare.
  const userColors = useMemo<Map<string, UserColor>>(() => {
    const ids = (orgUsers.data?.users ?? []).map((u: { id: string }) => u.id);
    return buildUserColorMap(ids);
  }, [orgUsers.data?.users]);

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarIcon size={24} /> Kalender
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Möten, förhandlingar, frister och tasks. Färgkodat per användare —
            markera vilka du vill se i listan till vänster.
          </p>
        </div>
        {currentUser.data && (
          <div className="inline-flex items-center gap-2 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-3 py-1.5 shrink-0">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: userColors.get(currentUser.data.id)?.border ?? "#999" }}
            />
            Inloggad som <strong className="text-gray-900">{currentUser.data.name}</strong>
          </div>
        )}
      </div>

      <section className="mb-8 grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-4">
        <UserPicker
          selectedUserIds={selectedUserIds}
          onChange={setSelectedUserIds}
          enforceAtLeastOne
          userColors={userColors}
        />
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-800">Events</h2>
              <ViewSwitcher value={view} onChange={setView} />
            </div>
            <button
              onClick={() => setShowNewEvent((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              <Plus size={14} /> Nytt event
            </button>
          </div>
          {showNewEvent && <NewEventForm onClose={() => setShowNewEvent(false)} />}
          {editingEvent && (
            <NewEventForm
              initial={editingEvent}
              onClose={() => setEditingEvent(null)}
            />
          )}
          {view === "list" && <EventList />}
          {/* anchor är null fram till första mount — då renderar vi en
              osynlig placeholder så SSR-HTML matchar klientens första render. */}
          {!anchor && <div data-calendar-placeholder className="h-64" aria-hidden />}
          {anchor && view === "day" && (
            <DayView anchor={anchor} onAnchorChange={setAnchor} userIds={selectedUserIds} userNames={userNames} userColors={userColors} onSelectEvent={setSelectedEvent} />
          )}
          {anchor && (view === "week" || view === "month") && (
            <CalendarGrid
              mode={view}
              userIds={selectedUserIds}
              userNames={userNames}
              userColors={userColors}
              anchor={anchor}
              onAnchorChange={setAnchor}
              onSelectEvent={setSelectedEvent}
            />
          )}
          <EventDetailModal
            event={selectedEvent}
            userName={selectedEvent ? (userNames[selectedEvent.userId] ?? "?") : ""}
            color={selectedEvent ? userColors.get(selectedEvent.userId) : undefined}
            onClose={() => setSelectedEvent(null)}
            onEdit={(ev) => { setSelectedEvent(null); setEditingEvent(ev as unknown as EventRow); }}
          />
        </div>
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
  const del = trpc.calendar.delete.useMutation({ onSuccess: () => utils.calendar.invalidate() });

  const handleDelete = (ev: EventRow) => {
    if (!confirm(`Ta bort "${ev.title}"?`)) return;
    if (ev.outlookEventId) {
      enqueueMirror({
        eventId: ev.id, op: "delete",
        outlookEventId: ev.outlookEventId, outlookCalendarId: ev.outlookCalendarId ?? null,
      });
    }
    del.mutate({ id: ev.id });
  };

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
            onClick={() => handleDelete(ev)}
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

// eslint-disable-next-line complexity
function NewEventForm({ onClose, initial }: { onClose: () => void; initial?: EventRow }) {
  const utils = trpc.useUtils();
  const isEdit = !!initial;
  const matters = trpc.matter.list.useQuery({ pageSize: 500, status: "ACTIVE" });

  const onCreateOrUpdateSuccess = (saved: EventRow): void => {
    utils.calendar.invalidate();
    if (saved.mirrorToOutlook) {
      enqueueMirror({
        eventId: saved.id,
        op: "upsert",
        event: {
          title: saved.title,
          description: null,
          location: saved.location ?? null,
          startAt: typeof saved.startAt === "string" ? saved.startAt : saved.startAt.toISOString(),
          endAt: saved.endAt ? (typeof saved.endAt === "string" ? saved.endAt : saved.endAt.toISOString()) : null,
          allDay: saved.allDay,
          visibility: "normal",
          kind: saved.kind,
        },
        outlookCalendarId: saved.outlookCalendarId ?? null,
      });
    }
    onClose();
  };

  const create = trpc.calendar.create.useMutation({ onSuccess: onCreateOrUpdateSuccess });
  const update = trpc.calendar.update.useMutation({ onSuccess: onCreateOrUpdateSuccess });

  // Hjälpare: ISO → datetime-local-värde "YYYY-MM-DDTHH:mm"
  const toLocalInput = (d: Date | string | null | undefined): string => {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  };

  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<"appointment" | "deadline">(initial?.kind ?? "appointment");
  const [startAt, setStartAt] = useState(initial ? toLocalInput(initial.startAt) : new Date().toISOString().slice(0, 16));
  const [endAt, setEndAt] = useState(initial?.endAt ? toLocalInput(initial.endAt) : "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [matterId, setMatterId] = useState(initial?.matterId ?? "");
  const [mirrorToOutlook, setMirrorToOutlook] = useState(initial?.mirrorToOutlook ?? false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      title,
      kind,
      startAt: new Date(startAt),
      endAt: endAt && kind === "appointment" ? new Date(endAt) : undefined,
      location: location || undefined,
      matterId: matterId || undefined,
      mirrorToOutlook,
    };
    if (isEdit && initial) update.mutate({ id: initial.id, ...payload });
    else create.mutate(payload);
  };

  const pending = create.isPending || update.isPending;

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
      <div>
        <MatterCombobox
          label="Ärende (vad mötet handlar om)"
          matters={matters.data?.matters ?? []}
          value={matterId}
          onChange={setMatterId}
          placeholder="Valfritt — sök på ärendenr eller titel…"
        />
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
        <button type="submit" disabled={!title || pending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {pending ? "Sparar…" : isEdit ? "Spara ändringar" : "Skapa"}
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
  matterId?: string | null;
  matter?: { id: string; matterNumber: string; title: string } | null;
  mirrorToOutlook?: boolean;
  mirrorStatus?: "pending" | "synced" | "failed" | null;
  outlookEventId?: string | null;
  outlookCalendarId?: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  dueAt?: string | Date | null;
  matter?: { id: string; matterNumber: string; title: string } | null;
}

function ViewSwitcher({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: { v: ViewMode; label: string; Icon: typeof List }[] = [
    { v: "list", label: "Lista", Icon: List },
    { v: "day", label: "Dag", Icon: Sun },
    { v: "week", label: "Vecka", Icon: LayoutGrid },
    { v: "month", label: "Månad", Icon: CalendarDays },
  ];
  return (
    <div className="inline-flex rounded-md border border-gray-200 bg-white text-xs">
      {opts.map(({ v, label, Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`flex items-center gap-1 px-2 py-1 ${value === v ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}
        >
          <Icon size={12} /> {label}
        </button>
      ))}
    </div>
  );
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
