"use client";

/**
 * `TodoClient` — Att-göra-vy med CRUD för tasks.
 *
 * - Dag-väljare (Igår/Idag/Imorgon + datum)
 * - User-väljare (visa annan kollegas)
 * - + Ny — öppnar TaskModal
 * - Klick på task → edit-modal
 * - Klick på checkbox → toggle DONE
 * - Trash → ta bort
 *
 * Events visas read-only (skapas via integrationer; ej CRUD här).
 */

import { useEffect, useMemo, useState } from "react";
import { Calendar, CheckSquare, Square, Clock, MapPin, Trash2, Pencil, Plus } from "lucide-react";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { Modal } from "@/components/ui/modal";
import { deadlineColor, type DeadlineColor } from "@/lib/shared/deadline-color";
import { rangeForView, shiftAnchor, viewRangeLabel, groupByDay, type TodoView } from "@/lib/client/todo/todo-views";

const TASK_STATUS_LABELS: Record<string, string> = { TODO: "Att göra", IN_PROGRESS: "Pågår", DONE: "Klar" };
const TASK_PRIORITY_LABELS: Record<string, string> = { LOW: "Låg", MEDIUM: "Medium", HIGH: "Hög" };
const EVENT_KIND_LABELS: Record<string, string> = { appointment: "Möte", deadline: "Frist" };

// Vänster-kant-färg per deadline-status (#88). border-transparent när ingen
// färg så radhöjden inte hoppar mellan färgad/ofärgad.
const DEADLINE_BORDER: Record<DeadlineColor, string> = {
  green: "border-l-4 border-green-500",
  yellow: "border-l-4 border-amber-500",
  red: "border-l-4 border-red-500",
};
const VIEW_LABELS: Record<TodoView, string> = { day: "Dag", week: "Vecka", month: "Månad" };
const VIEW_PREF_KEY = "ava.todo.view";

function readStoredView(): TodoView {
  if (typeof localStorage === "undefined") return "day";
  const v = localStorage.getItem(VIEW_PREF_KEY);
  return v === "week" || v === "month" ? v : "day";
}

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function toInputDate(d: Date): string {
  // Använd LOKAL-datum (inte UTC) — annars visar input fel dag för användare
  // öster om UTC innan kl 02:00 lokalt (toISOString → UTC → föregående dag).
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromInputDate(s: string): Date { const [y, m, day] = s.split("-").map(Number); return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1); }

interface TaskForm {
  id?: string;
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  dueAt: string; // ISO date or datetime-local
  matterId: string;
}

function emptyForm(defaultDate: Date): TaskForm {
  const d = new Date(defaultDate);
  d.setHours(9, 0, 0, 0);
  return {
    title: "",
    description: "",
    priority: "MEDIUM",
    dueAt: d.toISOString().slice(0, 16),
    matterId: "",
  };
}

/* eslint-disable max-lines-per-function, complexity -- JSX-tung med dag/user-väljare + lista + modal-CRUD */
export default function TodoClient() {
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [view, setView] = useState<TodoView>(() => readStoredView());
  const [userId, setUserId] = useState<string>("");
  const [modalState, setModalState] = useState<{ mode: "create" | "edit"; form: TaskForm } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(VIEW_PREF_KEY, view); } catch { /* pref ej kritisk */ }
  }, [view]);
  const now = new Date();

  const users = trpc.user.list.useQuery();
  const me = trpc.user.current.useQuery();
  const effectiveUserId = userId || me.data?.id;
  const isOwn = !userId || userId === me.data?.id;

  const range = useMemo(() => rangeForView(view, day), [view, day]);
  const items = trpc.todo.list.useQuery(
    { from: range.from, to: range.to, ...(effectiveUserId ? { userId: effectiveUserId } : {}) },
    // Gate på me.data → demo-runtime hydrerar users asynkront; utan gate
    // kraschar första query:n innan user existerar i datalagret.
    { enabled: !!effectiveUserId && !!me.data?.id },
  );
  const matters = trpc.matter.list.useQuery({ pageSize: 200, status: "ACTIVE" });
  const utils = trpc.useUtils();

  const refresh = () => utils.todo.list.invalidate();
  const createTask = trpc.task.create.useMutation({ onSuccess: () => { void refresh(); setModalState(null); } });
  const updateTask = trpc.task.update.useMutation({ onSuccess: () => { void refresh(); setModalState(null); } });
  const completeTask = trpc.task.complete.useMutation({ onSuccess: refresh });
  const updateTaskStatus = trpc.task.update.useMutation({ onSuccess: refresh });
  const deleteTask = trpc.task.delete.useMutation({ onSuccess: refresh });

  const periodLabel = viewRangeLabel(view, day);

  function submitForm(): void {
    if (!modalState) return;
    const f = modalState.form;
    const payload = {
      title: f.title,
      description: f.description || undefined,
      priority: f.priority,
      dueAt: f.dueAt ? new Date(f.dueAt) : undefined,
      matterId: f.matterId || undefined,
    };
    if (modalState.mode === "edit" && f.id) {
      updateTask.mutate({ id: f.id, ...payload });
    } else {
      createTask.mutate(payload);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Att göra <span className="ml-2 text-base font-normal text-gray-500 capitalize">{periodLabel}</span></h1>
        <div className="flex items-center gap-2">
          {/* Vy-växel Dag/Vecka/Månad (#88) */}
          <div role="group" aria-label="Vy" className="inline-flex rounded border overflow-hidden">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm ${view === v ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-50"}`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <button onClick={() => setDay((d) => shiftAnchor(view, d, -1))} aria-label="Föregående" className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">←</button>
          <button onClick={() => setDay(startOfDay(new Date()))} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">Idag</button>
          <button onClick={() => setDay((d) => shiftAnchor(view, d, 1))} aria-label="Nästa" className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">→</button>
          <input
            type="date"
            value={toInputDate(day)}
            onChange={(e) => setDay(startOfDay(fromInputDate(e.target.value)))}
            className="px-2 py-1.5 text-sm border rounded"
          />
          {isOwn && (
            <button onClick={() => setModalState({ mode: "create", form: emptyForm(day) })}
              className="ml-2 inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
              <Plus size={14} /> Ny
            </button>
          )}
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

      {(() => {
        const handlers = {
          isOwn,
          now,
          onToggle: (it: TodoRow) => {
            if (it.status === "DONE") updateTaskStatus.mutate({ id: it.id, status: "TODO" });
            else completeTask.mutate({ id: it.id });
          },
          onEdit: (it: TodoRow) => setModalState({
            mode: "edit",
            form: {
              id: it.id, title: it.title, description: "", priority: "MEDIUM",
              dueAt: new Date(it.at).toISOString().slice(0, 16),
              matterId: it.matter?.id ?? "",
            },
          }),
          onDelete: (it: TodoRow) => { if (confirm(`Ta bort "${it.title}"?`)) deleteTask.mutate({ id: it.id }); },
        };
        const data = items.data ?? [];
        if (view === "day") return <TodoList items={data} isLoading={items.isLoading} {...handlers} />;
        return <GroupedTodoList items={data} isLoading={items.isLoading} {...handlers} />;
      })()}

      <Modal open={!!modalState} title={modalState?.mode === "edit" ? "Ändra Att-göra" : "Ny Att-göra"} onClose={() => setModalState(null)} widthClass="max-w-xl">
        {modalState && (
          <TaskForm
            form={modalState.form}
            setForm={(f) => setModalState({ ...modalState, form: f })}
            matters={matters.data?.matters ?? []}
            onCancel={() => setModalState(null)}
            onSubmit={submitForm}
            isPending={createTask.isPending || updateTask.isPending}
            submitLabel={modalState.mode === "edit" ? "Spara" : "Skapa"}
          />
        )}
      </Modal>
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

interface ListProps {
  items: TodoRow[];
  isLoading: boolean;
  isOwn: boolean;
  now: Date;
  onToggle: (it: TodoRow) => void;
  onEdit: (it: TodoRow) => void;
  onDelete: (it: TodoRow) => void;
}

function TodoList({ items, isLoading, isOwn, now, onToggle, onEdit, onDelete }: ListProps) {
  if (isLoading) return <p className="text-sm text-gray-400">Laddar…</p>;
  if (items.length === 0) return <p className="text-sm text-gray-500">Inget på agendan denna period.</p>;

  return (
    <ul className="divide-y divide-gray-200 bg-white border border-gray-200 rounded-lg overflow-hidden">
      {items.map((it) => <TodoLi key={`${it.source}-${it.id}`} it={it} isOwn={isOwn} now={now} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />)}
    </ul>
  );
}

/** Vecka/månad: gruppera per dag med datum-rubrik. Återanvänder rad-renderingen. */
function GroupedTodoList({ items, isLoading, isOwn, now, onToggle, onEdit, onDelete }: ListProps) {
  if (isLoading) return <p className="text-sm text-gray-400">Laddar…</p>;
  if (items.length === 0) return <p className="text-sm text-gray-500">Inget på agendan denna period.</p>;

  const groups = groupByDay(items);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1 capitalize">
            {g.day.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" })}
          </h2>
          <ul className="divide-y divide-gray-200 bg-white border border-gray-200 rounded-lg overflow-hidden">
            {g.items.map((it) => <TodoLi key={`${it.source}-${it.id}`} it={it} isOwn={isOwn} now={now} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />)}
          </ul>
        </section>
      ))}
    </div>
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

function TodoIcon({ it, onToggle, isOwn }: { it: TodoRow; onToggle: (it: TodoRow) => void; isOwn: boolean }) {
  if (it.source !== "task") {
    if (it.kind === "deadline") return <Clock size={16} className="text-gray-400 shrink-0" />;
    return <Calendar size={16} className="text-gray-400 shrink-0" />;
  }
  if (!isOwn) {
    return it.status === "DONE"
      ? <CheckSquare size={16} className="text-green-500 shrink-0" />
      : <Square size={16} className="text-gray-300 shrink-0" />;
  }
  return (
    <button type="button" onClick={() => onToggle(it)} aria-label="Toggla klar" className="shrink-0">
      {it.status === "DONE"
        ? <CheckSquare size={16} className="text-green-500 hover:text-green-700" />
        : <Square size={16} className="text-gray-400 hover:text-gray-600" />}
    </button>
  );
}

interface LiProps {
  it: TodoRow;
  isOwn: boolean;
  now: Date;
  onToggle: (it: TodoRow) => void;
  onEdit: (it: TodoRow) => void;
  onDelete: (it: TodoRow) => void;
}

function TodoLi({ it, isOwn, now, onToggle, onEdit, onDelete }: LiProps) {
  const isDone = it.source === "task" && it.status === "DONE";
  const editable = isOwn && it.source === "task";
  // Deadline-färg endast för uppgifter (events har egen tidslogik). #88
  const color = it.source === "task" ? deadlineColor(it.at, now, { done: isDone }) : null;
  const borderClass = color ? DEADLINE_BORDER[color] : "border-l-4 border-transparent";
  return (
    <li
      data-deadline={color ?? "none"}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 ${borderClass} ${isDone ? "opacity-60" : ""}`}
    >
      <TodoIcon it={it} onToggle={onToggle} isOwn={isOwn} />
      <span className="font-mono text-xs text-gray-500 w-28 shrink-0">{timeLabelFor(it)}</span>
      {editable ? (
        <button
          type="button"
          onClick={() => onEdit(it)}
          title="Öppna och ändra"
          className={`flex-1 min-w-0 truncate text-left text-blue-600 hover:underline ${isDone ? "line-through" : ""}`}
        >
          {it.title}
        </button>
      ) : (
        <span className={`flex-1 min-w-0 truncate ${isDone ? "line-through" : ""}`}>{it.title}</span>
      )}
      {it.location && (
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-500"><MapPin size={11} /> {it.location}</span>
      )}
      {it.matter && (
        <EntityLink route="matters" id={it.matter.id} className="text-xs text-blue-600 hover:underline truncate max-w-[12rem]" title={it.matter.title}>
          {it.matter.matterNumber}
        </EntityLink>
      )}
      <span className="text-[10px] rounded-full bg-gray-100 text-gray-700 px-2 py-0.5">{tagFor(it)}</span>
      {isOwn && it.source === "task" && (
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => onEdit(it)} className="text-gray-400 hover:text-blue-600" aria-label="Ändra">
            <Pencil size={14} />
          </button>
          <button type="button" onClick={() => onDelete(it)} className="text-gray-400 hover:text-red-600" aria-label="Ta bort">
            <Trash2 size={14} />
          </button>
        </span>
      )}
    </li>
  );
}

interface FormProps {
  form: TaskForm;
  setForm: (f: TaskForm) => void;
  matters: Array<{ id: string; matterNumber: string; title: string }>;
  onCancel: () => void;
  onSubmit: () => void;
  isPending: boolean;
  submitLabel: string;
}

function TaskForm({ form, setForm, matters, onCancel, onSubmit, isPending, submitLabel }: FormProps) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Titel *</label>
        <input type="text" required value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="T.ex. Ring klient om bodelningsavtalet"
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Beskrivning</label>
        <textarea value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Datum/tid</label>
          <input type="datetime-local" value={form.dueAt}
            onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Prioritet</label>
          <select value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value as TaskForm["priority"] })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
            {(["LOW", "MEDIUM", "HIGH"] as const).map((p) => (
              <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Ärende (valfritt)</label>
        <select value={form.matterId}
          onChange={(e) => setForm({ ...form, matterId: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
          <option value="">— Inget ärende —</option>
          {matters.map((m) => (
            <option key={m.id} value={m.id}>{m.matterNumber} — {m.title}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
          Avbryt
        </button>
        <button type="submit" disabled={isPending || !form.title.trim()}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
          {isPending ? "Sparar…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
