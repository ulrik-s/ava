"use client";

/**
 * Åtgärder på bevakningar (#1167) — bocka av och lägga till. Delas av
 * startsidans kort och sidan "Att bevaka" så båda uppdaterar samma listor.
 */

import { trpc } from "@/lib/client/trpc";
import { asId } from "@/lib/shared/schemas/ids";

function useInvalidateWatch(): () => void {
  const utils = trpc.useUtils();
  return () => {
    void utils.watchlist.list.invalidate();
    void utils.task.listForMatter.invalidate();
  };
}

/** Markera en bevakning (uppgift) som klar. */
export function useCompleteWatch(): (taskId: string) => void {
  const complete = trpc.task.complete.useMutation({ onSuccess: useInvalidateWatch() });
  return (taskId) => complete.mutate({ id: asId<"TaskId">(taskId) });
}

/** Lägg till en bevakning utan ärende: titel + datum (lokal midnatt). */
export function useCreateWatch(onDone: () => void): { create: (title: string, ymd: string) => void; pending: boolean } {
  const invalidate = useInvalidateWatch();
  const m = trpc.task.create.useMutation({ onSuccess: () => { invalidate(); onDone(); } });
  return {
    create: (title, ymd) => m.mutate({ title: title.trim(), dueAt: new Date(`${ymd}T00:00:00`) }),
    pending: m.isPending,
  };
}
