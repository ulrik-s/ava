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

import { useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, CheckSquare, Square, Clock, MapPin, Trash2, Pencil, Plus } from "lucide-react";
import { trpc } from "@/lib/client/trpc";
import { Modal } from "@/components/ui/modal";

const TASK_STATUS_LABELS: Record<string, string> = { TODO: "Att göra", IN_PROGRESS: "Pågår", DONE: "Klar" };
const TASK_PRIORITY_LABELS: Record<string, string> = { LOW: "Låg", MEDIUM: "Medium", HIGH: "Hög" };
const EVENT_KIND_LABELS: Record<string, string> = { appointment: "Möte", deadline: "Frist" };

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function toInputDate(d: Date): string { return d.toISOString().slice(0, 10); }
function fromInputDate(s: string): Date { const [y, m, day] = s.split("-").map(Number); return new Date(y, (m ?? 1) - 1, day ?? 1); }
function shiftDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

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
  const [userId, setUserId] = useState<string>("");
  const [modalState, setModalState] = useState<{ mode: "create" | "edit"; form: TaskForm } | null>(null);

  const users = trpc.user.list.useQuery();
  const me = trpc.user.current.useQuery();
  const effectiveUserId = userId || me.data?.id;
  const isOwn = !userId || userId === me.data?.id;

  const range = useMemo(() => ({ from: startOfDay(day), to: endOfDay(day) }), [day]);
  const items = trpc.todo.list.useQuery(
    { from: range.from, to: range.to, ...(effectiveUserId ? { userId: effectiveUserId } : {}) },
    { enabled: !!effectiveUserId },
  );
  const matters = trpc.matter.list.useQuery({ pageSize: 200, status: "ACTIVE" });
  const utils = trpc.useUtils();

  const refresh = () => utils.todo.list.invalidate();
  const createTask = trpc.task.create.useMutation({ onSuccess: () => { refresh(); setModalState(null); } });
  const updateTask = trpc.task.update.useMutation({ onSuccess: () => { refresh(); setModalState(null); } });
  const completeTask = trpc.task.complete.useMutation({ onSuccess: refresh });
  const updateTaskStatus = trpc.task.update.useMutation({ onSuccess: refresh });
  const deleteTask = trpc.task.delete.useMutation({ onSuccess: refresh });

  const dayLabel = day.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });

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

      <TodoList
        items={items.data ?? []}
        isLoading={items.isLoading}
        isOwn={isOwn}
        onToggle={(it) => {
          if (it.status === "DONE") {
            updateTaskStatus.mutate({ id: it.id, status: "TODO" });
          } else {
            completeTask.mutate({ id: it.id });
          }
        }}
        onEdit={(it) => {
          setModalState({
            mode: "edit",
            form: {
              id: it.id,
              title: it.title,
              description: "",
              priority: "MEDIUM",
              dueAt: new Date(it.at).toISOString().slice(0, 16),
              matterId: it.matter?.id ?? "",
            },
          });
        }}
        onDelete={(it) => {
          if (confirm(`Ta bort "${it.title}"?`)) deleteTask.mutate({ id: it.id });
        }}
      />

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
  onToggle: (it: TodoRow) => void;
  onEdit: (it: TodoRow) => void;
  onDelete: (it: TodoRow) => void;
}

function TodoList({ items, isLoading, isOwn, onToggle, onEdit, onDelete }: ListProps) {
  if (isLoading) return <p className="text-sm text-gray-400">Laddar…</p>;
  if (items.length === 0) return <p className="text-sm text-gray-500">Inget på agendan denna dag.</p>;

  return (
    <ul className="divide-y divide-gray-200 bg-white border border-gray-200 rounded-lg overflow-hidden">
      {items.map((it) => <TodoLi key={`${it.source}-${it.id}`} it={it} isOwn={isOwn} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />)}
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
  onToggle: (it: TodoRow) => void;
  onEdit: (it: TodoRow) => void;
  onDelete: (it: TodoRow) => void;
}

function TodoLi({ it, isOwn, onToggle, onEdit, onDelete }: LiProps) {
  const isDone = it.source === "task" && it.status === "DONE";
  return (
    <li className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 ${isDone ? "opacity-60" : ""}`}>
      <TodoIcon it={it} onToggle={onToggle} isOwn={isOwn} />
      <span className="font-mono text-xs text-gray-500 w-28 shrink-0">{timeLabelFor(it)}</span>
      <span className={`flex-1 min-w-0 truncate ${isDone ? "line-through" : ""}`}>{it.title}</span>
      {it.location && (
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-500"><MapPin size={11} /> {it.location}</span>
      )}
      {it.matter && (
        <Link href={`/matters/${it.matter.id}`} className="text-xs text-blue-600 hover:underline truncate max-w-[12rem]" title={it.matter.title}>
          {it.matter.matterNumber}
        </Link>
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
