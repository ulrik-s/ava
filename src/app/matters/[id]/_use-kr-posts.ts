/**
 * Kostnadsräkningens postlista (#1889): urvalet ur fakturaförslaget, och de
 * valda tidsposterna och utläggen med hela raderna, som dokumentet byggs på.
 * Delas av brottmålsmodalen och rättshjälpsdialogen, så att dokumentet och
 * servern får exakt samma poster.
 *
 * `useKrPosts` hämtar ingenting själv: den tar svaren in. `useMatterKrPosts`
 * läser förslaget och ärendets tidsposter med den nya bindningen (`useTRPC`,
 * ADR 0041, #1929), så att båda dialogerna läser samma frågor.
 */
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useTRPC } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { selectedPosts, usePostSelection, type PostSelection } from "./_post-selection";

type Outputs = inferRouterOutputs<AppRouter>;
type TimeEntryRow = Outputs["timeEntry"]["list"]["entries"][number];

/** Det som postlistan läser: fakturaförslaget och ärendets tidsposter, med laddningsläge. */
export interface KrPostSources {
  proposal: { data: Outputs["billingRun"]["proposal"] | undefined; isLoading: boolean };
  timeEntries: { data: Outputs["timeEntry"]["list"] | undefined; isLoading: boolean };
}

/** Urvalet och de valda posterna. `loading` tills förslaget och tidsposterna lästs in. */
export interface KrPosts<E> {
  selection: PostSelection;
  entries: TimeEntryRow[];
  expenses: E[];
  loading: boolean;
}

export function useKrPosts<E extends { id: string }>(sources: KrPostSources, allExpenses: ReadonlyArray<E>): KrPosts<E> {
  const { proposal, timeEntries } = sources;
  const selection = usePostSelection(proposal.data);
  return {
    selection,
    entries: selectedPosts(timeEntries.data?.entries ?? [], "te", selection.selected),
    expenses: selectedPosts(allExpenses, "ex", selection.selected),
    loading: proposal.isLoading || timeEntries.isLoading,
  };
}

/** Postlistan ur ärendets fakturaförslag och tidsposter (de första 100). */
export function useMatterKrPosts<E extends { id: string }>(matterId: MatterId, allExpenses: ReadonlyArray<E>): KrPosts<E> {
  const trpc = useTRPC();
  const proposal = useQuery(trpc.billingRun.proposal.queryOptions({ matterId }));
  const timeEntries = useQuery(trpc.timeEntry.list.queryOptions({ matterId, pageSize: 100 }));
  return useKrPosts({ proposal, timeEntries }, allExpenses);
}
