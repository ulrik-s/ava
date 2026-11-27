/**
 * Kostnadsräkningens postlista (#1889): urvalet ur fakturaförslaget, och de
 * valda tidsposterna och utläggen med hela raderna, som dokumentet byggs på.
 * Delas av brottmålsmodalen och rättshjälpsdialogen, så att dokumentet och
 * servern får exakt samma poster.
 */
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { selectedPosts, usePostSelection, type PostSelection } from "./_post-selection";

type TimeEntryRow = inferRouterOutputs<AppRouter>["timeEntry"]["list"]["entries"][number];

/** Urvalet och de valda posterna. `loading` tills förslaget och tidsposterna lästs in. */
export interface KrPosts<E> {
  selection: PostSelection;
  entries: TimeEntryRow[];
  expenses: E[];
  loading: boolean;
}

export function useKrPosts<E extends { id: string }>(matterId: MatterId, allExpenses: ReadonlyArray<E>): KrPosts<E> {
  const proposal = trpc.billingRun.proposal.useQuery({ matterId });
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId, pageSize: 100 });
  const selection = usePostSelection(proposal.data);
  return {
    selection,
    entries: selectedPosts(timeEntries.data?.entries ?? [], "te", selection.selected),
    expenses: selectedPosts(allExpenses, "ex", selection.selected),
    loading: proposal.isLoading || timeEntries.isLoading,
  };
}
