"use client";

/**
 * /calendar — användarens kalender (möten, förhandlingar, frister) + tasks.
 *
 * Vy: lista nu — månadsgrid och veckovy i CalendarGrid-komponenten.
 * Outlook-spegling enqueue:as automatiskt på create/update/delete via
 * `enqueueMirror()` när `mirrorToOutlook=true`.
 */

import { Calendar as CalendarIcon, Plus, ExternalLink, Trash2, CheckCircle2, List, LayoutGrid, CalendarDays, Sun } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { MatterCombobox } from "@/components/matter/matter-combobox";
import { CheckboxList } from "@/components/ui/checkbox-list";
import { resolveSelectedUsers } from "@/lib/client/calendar/select-users";
import { buildUserColorMap, type UserColor } from "@/lib/client/calendar/user-colors";
import { jobQueue } from "@/lib/client/jobs/job-queue";
import { trpc } from "@/lib/client/trpc";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { asId, type CalendarEventId, type ContactId, type MatterId, type UserId } from "@/lib/shared/schemas/ids";
import { CalendarGrid, startOfDay } from "./_calendar-grid";
import { DayView } from "./_day-view";
import { EventDetailModal, type EventDetail } from "./_event-detail-modal";
import { UserPicker, loadSelectedUserIds } from "./_user-picker";

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

// type-alias (inte interface) → får implicit index-signatur och är därmed
// tilldelningsbar till jobQueue.enqueue:s `Record<string, unknown>`-payload
// utan cast.
type MirrorArgs = {
  eventId: CalendarEventId;
  op: "upsert" | "delete";
  event?: EventForMirror;
  outlookEventId?: string | null;
  outlookCalendarId?: string | null;
};

/**
 * Enqueue:a en mirror-to-outlook-worker. Fire-and-forget; workern
 * uppdaterar mirrorStatus efter sync och calendar.list invalidate:as.
 */
function enqueueMirror(args: MirrorArgs): void {
  const label = args.op === "delete"
    ? `Tar bort i Outlook: ${args.eventId.slice(0, 8)}`
    : `Speglar till Outlook: ${args.event?.title ?? ""}`;
  jobQueue.enqueue("mirror-to-outlook", label, args);
}

/**
 * Kalender-sidans state: anchor (date-param-deep-link), vy, multi-user-val
 * samt namn-/färgmappar. Effekterna är hydration-säkra — de initialiserar
 * deterministiskt till null/[] och fyller efter mount, så SSR-HTML matchar
 * klientens första render.
 */
function useCalendarState() {
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [view, setView] = useState<ViewMode>("week");
  const currentUser = trpc.user.current.useQuery();
  const orgUsers = trpc.user.list.useQuery();
  const [selectedUserIds, setSelectedUserIds] = useState<UserId[]>([]);
  const [userSelInit, setUserSelInit] = useState(false);

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

  useEffect(() => {
    // Default: bara mig, men ?date=-deep-link (från matter) väljer alla så
    // event av andra ägare syns. Beslutet lever i pure resolveSelectedUsers.
    // Vänta tills minst current-user laddats så vi inte sätter [] permanent.
    if (userSelInit) return;
    const hasDateParam = typeof window !== "undefined" && new URL(window.location.href).searchParams.has("date");
    const orgIds = (orgUsers.data?.users ?? []).map((u: { id: string }) => u.id);
    const resolved = resolveSelectedUsers({
      stored: loadSelectedUserIds(),
      currentUserId: currentUser.data?.id ?? null,
      orgUserIds: orgIds,
      hasDateParam,
    });
    if (resolved.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedUserIds(resolved.map((uid) => asId<"UserId">(uid)));
      setUserSelInit(true);
    }
  }, [currentUser.data?.id, orgUsers.data?.users, userSelInit]);

  // Namn-/färgmappar byggs över ALLA org-användare så de är stabila även när
  // man togglar individer i pickern. buildUserColorMap sorterar id:na
  // deterministiskt och garanterar unika färger för ≤12 användare.
  const userNames = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const u of orgUsers.data?.users ?? []) m[u.id] = u.name;
    return m;
  }, [orgUsers.data?.users]);

  const userColors = useMemo<Map<string, UserColor>>(() => {
    const ids = (orgUsers.data?.users ?? []).map((u: { id: string }) => u.id);
    return buildUserColorMap(ids);
  }, [orgUsers.data?.users]);

  return { anchor, setAnchor, view, setView, selectedUserIds, setSelectedUserIds, userNames, userColors };
}

export default function CalendarPage() {
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventDetail | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);
  const { anchor, setAnchor, view, setView, selectedUserIds, setSelectedUserIds, userNames, userColors } =
    useCalendarState();

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CalendarIcon size={24} /> Kalender
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Möten, förhandlingar, frister och tasks. Färgkodat per användare —
          markera vilka du vill se i listan till vänster.
        </p>
      </div>

      <section className="mb-8 grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-4">
        <UserPicker
          selectedUserIds={selectedUserIds}
          onChange={(ids) => setSelectedUserIds(ids.map((id) => asId<"UserId">(id)))}
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
          {editingEvent && <NewEventForm initial={editingEvent} onClose={() => setEditingEvent(null)} />}
          {view === "list" && <EventList />}
          <CalendarBody
            view={view}
            anchor={anchor}
            setAnchor={setAnchor}
            selectedUserIds={selectedUserIds}
            userNames={userNames}
            userColors={userColors}
            onSelectEvent={setSelectedEvent}
          />
          <EventDetailPanel
            selectedEvent={selectedEvent}
            userNames={userNames}
            userColors={userColors}
            onClose={() => setSelectedEvent(null)}
            onEdit={(ev) => { setSelectedEvent(null); setEditingEvent(ev); }}
          />
        </div>
      </section>

      <TasksSection />
    </div>
  );
}

/**
 * Renderar den valda vyn. anchor är null fram till första mount — då en
 * osynlig placeholder så SSR-HTML matchar klientens första render.
 */
function CalendarBody({ view, anchor, setAnchor, selectedUserIds, userNames, userColors, onSelectEvent }: {
  view: ViewMode;
  anchor: Date | null;
  setAnchor: (d: Date) => void;
  selectedUserIds: UserId[];
  userNames: Record<string, string>;
  userColors: Map<string, UserColor>;
  onSelectEvent: (ev: EventDetail) => void;
}) {
  if (!anchor) return <div data-calendar-placeholder className="h-64" aria-hidden />;
  if (view === "day") {
    return (
      <DayView anchor={anchor} onAnchorChange={setAnchor} userIds={selectedUserIds} userNames={userNames} userColors={userColors} onSelectEvent={onSelectEvent} />
    );
  }
  if (view === "week" || view === "month") {
    return (
      <CalendarGrid mode={view} userIds={selectedUserIds} userNames={userNames} userColors={userColors} anchor={anchor} onAnchorChange={setAnchor} onSelectEvent={onSelectEvent} />
    );
  }
  return null;
}

/** Detalj-modalen för ett valt event (med ägarens färg). */
function EventDetailPanel({ selectedEvent, userNames, userColors, onClose, onEdit }: {
  selectedEvent: EventDetail | null;
  userNames: Record<string, string>;
  userColors: Map<string, UserColor>;
  onClose: () => void;
  onEdit: (ev: EventDetail) => void;
}) {
  const color = selectedEvent ? userColors.get(selectedEvent.userId) : undefined;
  return (
    <EventDetailModal
      event={selectedEvent}
      userName={selectedEvent ? (userNames[selectedEvent.userId] ?? "?") : ""}
      {...(color ? { color } : {})}
      onClose={onClose}
      onEdit={onEdit}
    />
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
      {events.map((row) => {
        const ev: EventRow = row;
        return (
        <li key={ev.id} className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">{ev.title}</span>
              <KindBadge kind={ev.kind} />
              {ev.mirrorToOutlook && <MirrorBadge {...omitUndefined({ status: ev.mirrorStatus })} />}
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
        );
      })}
    </ul>
  );
}

// ─── Task-list ────────────────────────────────────────────────────────────

/** Tasks-sektionen: rubrik + "ny task"-toggle + listan. */
function TasksSection() {
  const [showNewTask, setShowNewTask] = useState(false);
  return (
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
  );
}

function TaskList() {
  const { data: tasks, isLoading } = trpc.task.list.useQuery();
  const utils = trpc.useUtils();
  const complete = trpc.task.complete.useMutation({ onSuccess: () => utils.task.list.invalidate() });
  const del = trpc.task.delete.useMutation({ onSuccess: () => utils.task.list.invalidate() });

  if (isLoading) return <p className="text-sm text-gray-500">Laddar…</p>;
  if (!tasks?.length) return <p className="text-sm text-gray-400 italic">Inga tasks ännu.</p>;

  return (
    <ul className="divide-y divide-gray-100 bg-white rounded-lg border border-gray-200">
      {tasks.map((row) => {
        const t: TaskRow = row;
        return (
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
        );
      })}
    </ul>
  );
}

// ─── Create forms ─────────────────────────────────────────────────────────

/** ISO/Date → datetime-local-värde "YYYY-MM-DDTHH:mm". */
function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/** Tomma initialvärden för ett nytt event (ingen redigerad rad). */
function emptyEventForm() {
  return {
    title: "",
    kind: "appointment" as "appointment" | "deadline",
    startAt: new Date().toISOString().slice(0, 16),
    endAt: "",
    location: "",
    matterId: asId<"MatterId">(""),
    mirrorToOutlook: false,
    inviteeUserIds: [] as UserId[],
    inviteeContactIds: [] as ContactId[],
  };
}

/** Initialvärden ur en redigerad rad. `i` är garanterat satt → vanlig
 *  fält-access (inte optional-chain), så komplexiteten stannar lågt. */
function eventFormFromRow(i: EventRow) {
  return {
    title: i.title,
    kind: i.kind,
    startAt: toLocalInput(i.startAt),
    endAt: i.endAt ? toLocalInput(i.endAt) : "",
    location: i.location ?? "",
    matterId: i.matterId ?? asId<"MatterId">(""),
    mirrorToOutlook: i.mirrorToOutlook ?? false,
    inviteeUserIds: i.inviteeUserIds ?? [],
    inviteeContactIds: i.inviteeContactIds ?? [],
  };
}

/** Initialvärden för event-formuläret ur en ev. redigerad rad. */
function eventFormDefaults(initial?: EventRow) {
  return initial ? eventFormFromRow(initial) : emptyEventForm();
}

/** Bygger mirror-to-outlook-argumenten (upsert) för en sparad event-rad. */
function buildMirrorArgs(saved: EventRow): MirrorArgs {
  const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());
  return {
    eventId: saved.id,
    op: "upsert",
    event: {
      title: saved.title,
      description: null,
      location: saved.location ?? null,
      startAt: iso(saved.startAt),
      endAt: saved.endAt ? iso(saved.endAt) : null,
      allDay: saved.allDay,
      visibility: "normal",
      kind: saved.kind,
    },
    outlookCalendarId: saved.outlookCalendarId ?? null,
  };
}

/** All state + mutationer för event-formuläret (create + edit). */
function useEventForm({ initial, onClose }: { initial?: EventRow | undefined; onClose: () => void }) {
  const utils = trpc.useUtils();
  const isEdit = !!initial;
  const matters = trpc.matter.list.useQuery({ pageSize: 500, status: "ACTIVE" });
  const orgUsers = trpc.user.list.useQuery();
  const contacts = trpc.contacts.list.useQuery({ pageSize: 500 });

  // Boundary-cast: mutationen returnerar en branded/optional tRPC-rad som är
  // bredare än vy-typen EventRow; vi läser bara de fält som finns.
  const onSuccess = (savedRow: unknown): void => {
    const saved = savedRow as EventRow;
    void utils.calendar.invalidate();
    if (saved.mirrorToOutlook) enqueueMirror(buildMirrorArgs(saved));
    onClose();
  };
  const create = trpc.calendar.create.useMutation({ onSuccess });
  const update = trpc.calendar.update.useMutation({ onSuccess });

  const d = eventFormDefaults(initial);
  const [title, setTitle] = useState(d.title);
  const [kind, setKind] = useState<"appointment" | "deadline">(d.kind);
  const [startAt, setStartAt] = useState(d.startAt);
  const [endAt, setEndAt] = useState(d.endAt);
  const [location, setLocation] = useState(d.location);
  const [matterId, setMatterId] = useState(d.matterId);
  const [mirrorToOutlook, setMirrorToOutlook] = useState(d.mirrorToOutlook);
  const [inviteeUserIds, setInviteeUserIds] = useState<UserId[]>(d.inviteeUserIds);
  const [inviteeContactIds, setInviteeContactIds] = useState<ContactId[]>(d.inviteeContactIds);

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
      inviteeUserIds,
      inviteeContactIds,
    };
    if (isEdit && initial) update.mutate({ id: initial.id, ...payload });
    else create.mutate(payload);
  };

  const matterOptions = matters.data?.matters ?? [];
  const userOptions = orgUsers.data?.users ?? [];
  const contactOptions = contacts.data?.contacts ?? [];

  return {
    isEdit, matterOptions, userOptions, contactOptions,
    title, setTitle, kind, setKind, startAt, setStartAt, endAt, setEndAt,
    location, setLocation, matterId, setMatterId,
    mirrorToOutlook, setMirrorToOutlook, inviteeUserIds, setInviteeUserIds,
    inviteeContactIds, setInviteeContactIds, submit,
    pending: create.isPending || update.isPending,
  };
}

interface InviteeOption { id: string; name: string; role?: string; contactType?: string }

/** De två "bjud in"-listorna (kollegor + kontakter). */
function InviteePickers({ users, contacts, userIds, setUserIds, contactIds, setContactIds }: {
  users: InviteeOption[];
  contacts: InviteeOption[];
  userIds: string[];
  setUserIds: (ids: string[]) => void;
  contactIds: string[];
  setContactIds: (ids: string[]) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <CheckboxList
        label="Bjud in kollegor"
        options={users.map((u) => ({ id: u.id, label: u.name, ...omitUndefined({ sublabel: u.role }) }))}
        selectedIds={userIds}
        onChange={setUserIds}
        placeholder="Sök kollega…"
      />
      <CheckboxList
        label="Bjud in från kontakter"
        options={contacts.map((c) => ({ id: c.id, label: c.name, ...omitUndefined({ sublabel: c.contactType }) }))}
        selectedIds={contactIds}
        onChange={setContactIds}
        placeholder="Sök kontakt…"
      />
    </div>
  );
}

function NewEventForm({ onClose, initial }: { onClose: () => void; initial?: EventRow }) {
  const f = useEventForm({ initial, onClose });
  return (
    <form onSubmit={f.submit} className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2">
          <span className="text-xs text-gray-600 mb-1 block">Titel *</span>
          <input
            type="text" required value={f.title}
            onChange={(e) => f.setTitle(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Typ</span>
          <select value={f.kind} onChange={(e) => f.setKind(e.target.value as "appointment" | "deadline")}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
            <option value="appointment">Möte / Förhandling</option>
            <option value="deadline">Frist</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Plats</span>
          <input
            type="text" value={f.location}
            onChange={(e) => f.setLocation(e.target.value)}
            placeholder="Stockholms tingsrätt, sal 5"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Start *</span>
          <input
            type="datetime-local" required value={f.startAt}
            onChange={(e) => f.setStartAt(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        {f.kind === "appointment" && (
          <label className="block">
            <span className="text-xs text-gray-600 mb-1 block">Slut</span>
            <input
              type="datetime-local" value={f.endAt}
              onChange={(e) => f.setEndAt(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>
        )}
      </div>
      <div>
        <MatterCombobox
          label="Ärende (vad mötet handlar om)"
          matters={f.matterOptions}
          value={f.matterId}
          onChange={f.setMatterId}
          placeholder="Valfritt — sök på ärendenr eller titel…"
        />
      </div>
      <InviteePickers
        users={f.userOptions}
        contacts={f.contactOptions}
        userIds={f.inviteeUserIds}
        setUserIds={(ids) => f.setInviteeUserIds(ids.map((id) => asId<"UserId">(id)))}
        contactIds={f.inviteeContactIds}
        setContactIds={(ids) => f.setInviteeContactIds(ids.map((id) => asId<"ContactId">(id)))}
      />
      <label className="flex items-center gap-2 text-xs text-gray-700">
        <input
          type="checkbox" checked={f.mirrorToOutlook}
          onChange={(e) => f.setMirrorToOutlook(e.target.checked)}
        />
        <ExternalLink size={12} /> Spegla till Outlook (kräver O365-anslutning)
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 hover:bg-white rounded">Avbryt</button>
        <button type="submit" disabled={!f.title || f.pending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {f.pending ? "Sparar…" : f.isEdit ? "Spara ändringar" : "Skapa"}
        </button>
      </div>
    </form>
  );
}

function NewTaskForm({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const create = trpc.task.create.useMutation({
    onSuccess: () => { void utils.task.list.invalidate(); onClose(); },
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
  id: CalendarEventId;
  title: string;
  kind: "appointment" | "deadline";
  startAt: string | Date;
  endAt?: string | Date | null | undefined;
  allDay: boolean;
  location?: string | null | undefined;
  matterId?: MatterId | null | undefined;
  matter?: { id: MatterId; matterNumber: string; title: string } | null | undefined;
  inviteeUserIds?: UserId[] | undefined;
  inviteeContactIds?: ContactId[] | undefined;
  mirrorToOutlook?: boolean | undefined;
  mirrorStatus?: "pending" | "synced" | "failed" | null | undefined;
  outlookEventId?: string | null | undefined;
  outlookCalendarId?: string | null | undefined;
}

interface TaskRow {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  dueAt?: string | Date | null | undefined;
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
