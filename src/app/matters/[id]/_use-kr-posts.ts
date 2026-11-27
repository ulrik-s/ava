/**
 * Kostnadsräkningens postlista (#1889): urvalet ur fakturaförslaget, och de
 * valda tidsposterna och utläggen med hela raderna, som dokumentet byggs på.
 * Delas av brottmålsmodalen och rättshjälpsdialogen, så att dokumentet och
 * servern får exakt samma poster.
 *
 * Hooken hämtar ingenting själv: anroparna läser förslaget och tidsposterna
 * och skickar in svaren. Den är då fri från den klassiska tRPC-bindningen
 * (#1926, ADR 0041), och anroparna flyttas till useTRPC i sin tur.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/server/routers/_app";
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
