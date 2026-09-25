"use client";

/**
 * Att bevaka i ärendet (#1162, #1167). Ärendets bevakningar — alla användares
 * (en frist angår alla som arbetar i ärendet); egna kan bockas av. En bevakning
 * som är inne eller passerad lyser rött med stor fet text, och samma poster
 * finns i den globala "Att bevaka". Under dem: ärendets övriga signaler ur den
 * globala listan (täckningstak, ofakturerat, förfallna fakturor) — EN lista,
 * inte två (Att göra och Att bevaka visade samma saker och förvirrade).
 */

import { useId, useState } from "react";
import { DeadlineBadge } from "@/components/tasks/deadline-badge";
import { sectionHeaderClass } from "@/components/ui/section-tone";
import { WatchlistList } from "@/components/watchlist/watchlist-list";
import { trpc } from "@/lib/client/trpc";
import { isDeadlineDue } from "@/lib/shared/deadline";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";

interface MatterTask {
  id: string;
  title: string;
  dueAt?: Date | string | null;
  status?: string | null;
  userId: string;
}

/** Öppna först (dueAt asc från servern, utan frist sist), klara för sig. */
function splitTasks(tasks: readonly MatterTask[]): { open: MatterTask[]; done: MatterTask[] } {
  const open = tasks.filter((t) => t.status !== "DONE");
  const withDue = open.filter((t) => t.dueAt != null);
  return { open: [...withDue, ...open.filter((t) => t.dueAt == null)], done: tasks.filter((t) => t.status === "DONE") };
}

export function WatchSection({ matterId }: { matterId: MatterId }) {
  const list = trpc.task.listForMatter.useQuery({ matterId });
  const me = trpc.user.current.useQuery();
  const users = trpc.user.list.useQuery();
  const [showDone, setShowDone] = useState(false);
  const { open, done } = splitTasks((list.data ?? []) as MatterTask[]);
  const nameOf = (id: string): string =>
    ((users.data?.users ?? []) as Array<{ id: string; name: string | null }>).find((u) => u.id === id)?.name ?? "kollega";

  return (
    <section aria-label="Att bevaka" className="bg-white rounded-lg border border-gray-200 mb-6">
      <div className={sectionHeaderClass("amber")}>
        <h2 className="font-semibold text-gray-900">Att bevaka ({open.length})</h2>
        {done.length > 0 && (
          <button type="button" onClick={() => setShowDone((v) => !v)} className="text-sm text-blue-600 hover:underline">
            {showDone ? "Dölj klara" : `Visa klara (${done.length})`}
          </button>
        )}
      </div>
      <AddTaskForm matterId={matterId} />
      {open.length === 0 && <p className="px-6 py-3 text-sm text-gray-500">Inga öppna bevakningar i ärendet.</p>}
      <ul className="divide-y divide-gray-100">
        {[...open, ...(showDone ? done : [])].map((t) => (
          <TaskRow key={t.id} task={t} matterId={matterId} own={t.userId === me.data?.id} ownerName={nameOf(t.userId)} />
        ))}
      </ul>
      <MatterSignals matterId={matterId} />
    </section>
  );
}

/**
 * Ärendets övriga signaler ur den globala "Att bevaka" (täckningstak,
 * ofakturerat, förfallna fakturor). Tidsfristerna står redan ovan som
 * bevakningar — de tas inte med två gånger.
 */
function MatterSignals({ matterId }: { matterId: MatterId }) {
  const q = trpc.watchlist.list.useQuery({ mine: false, matterId });
  const items = (q.data?.items ?? []).filter((i) => i.kind !== "deadline");
  if (items.length === 0) return null;
  return (
    <div className="px-6 py-3 border-t border-gray-100">
      <WatchlistList items={items} emptyText="" />
    </div>
  );
}

/** Invalidera allt som visar bevakningar: ärendet och den globala listan. */
function useInvalidateTasks(matterId: MatterId): () => void {
  const utils = trpc.useUtils();
  return () => {
    void utils.task.listForMatter.invalidate({ matterId });
    void utils.watchlist.list.invalidate();
  };
}

function AddTaskForm({ matterId }: { matterId: MatterId }) {
  const titleId = useId();
  const dateId = useId();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const invalidate = useInvalidateTasks(matterId);
  const create = trpc.task.create.useMutation({
    onSuccess: () => { setTitle(""); setDate(""); invalidate(); },
  });
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    // Datumet som lokal midnatt — en frist är en dag, inte ett klockslag.
    create.mutate({ title: title.trim(), matterId, dueAt: new Date(`${date}T00:00:00`) });
  };
  return (
    <form onSubmit={submit} className="px-6 py-3 flex flex-wrap items-end gap-2 border-b border-gray-100">
      <div className="flex-1 min-w-[12rem]">
        <label htmlFor={titleId} className="block text-xs font-medium text-gray-500 mb-1">Bevakning</label>
        <input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="t.ex. Överklagandefrist löper ut"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <div>
        <label htmlFor={dateId} className="block text-xs font-medium text-gray-500 mb-1">Bevakningsdatum</label>
        <input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      {/* En bevakning har alltid ett datum — det är datumet som gör den bevakningsbar. */}
      <button type="submit" disabled={!title.trim() || !date || create.isPending}
        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
        Lägg till
      </button>
    </form>
  );
}

function TaskRow({ task, matterId, own, ownerName }: { task: MatterTask; matterId: MatterId; own: boolean; ownerName: string }) {
  const invalidate = useInvalidateTasks(matterId);
  const complete = trpc.task.complete.useMutation({ onSuccess: invalidate });
  const reopen = trpc.task.update.useMutation({ onSuccess: invalidate });
  const done = task.status === "DONE";
  const due = isDeadlineDue(task);
  const toggle = (): void => {
    const id = asId<"TaskId">(task.id);
    if (done) reopen.mutate({ id, status: "TODO" });
    else complete.mutate({ id });
  };
  return (
    <li className={`px-6 py-3 flex flex-wrap items-center gap-3 ${due ? "bg-red-50 border-l-4 border-red-600" : ""}`}>
      <input type="checkbox" checked={done} disabled={!own} onChange={toggle}
        aria-label={`${done ? "Återöppna" : "Markera klar"}: ${task.title}`}
        title={own ? undefined : `Bara ${ownerName} kan bocka av`} />
      <span className={due ? "text-lg font-extrabold text-red-800" : `text-sm ${done ? "line-through text-gray-400" : "text-gray-900"}`}>
        {task.title}
      </span>
      <DeadlineBadge dueAt={task.dueAt} done={done} />
      {!own && <span className="text-xs text-gray-400">({ownerName})</span>}
    </li>
  );
}
