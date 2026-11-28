/**
 * Förifylld tRPC-cache för tester av den nya bindningen (ADR 0041, #1927).
 *
 * En komponent som läser `useQuery(t.x.queryOptions(…))` ritar först utan data
 * och sedan med svaret. Tester som (som med den gamla mocken) vill se datat
 * direkt fyller QueryClienten i förväg med `seed`. Inget blir inaktuellt av
 * sig självt (`staleTime: Infinity`), så länken frågas bara efter en
 * invalidering, och ändringar (`useMutation`) går som vanligt genom länken.
 */

import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { createTRPCOptionsProxy, type TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest-compat";
import type { AppRouter } from "@/lib/server/routers/_app";
import { fakeTrpcClient, fakeTrpcLink, TrpcTestProvider, type FakeTrpcLink, type InvalidateSpy, type TrpcHandlers } from "./trpc-fake";

/** Options-proxyn som ger nycklarna att fylla i (`t.prefs.get.queryKey({ key })`). */
export type TrpcProxy = TRPCOptionsProxy<AppRouter>;

/** Det en rendering ger: anropsloggen, QueryClienten och spionen på invalideringar. */
export interface SeededTrpcRender extends RenderResult {
  fake: FakeTrpcLink;
  queryClient: QueryClient;
  /** Spion på `queryClient.invalidateQueries`; läs med `invalidatedPaths`. */
  invalidate: InvalidateSpy;
}

/**
 * Lägger ett svar i cachen. Testdatat har ofta bara de fält komponenten
 * läser, så nyckeln tas som en vanlig `QueryKey` och datat som `unknown`.
 */
export function seedQuery(qc: QueryClient, queryKey: QueryKey, data: unknown): void {
  qc.setQueryData(queryKey, data);
}

/** En QueryClient utan omförsök där inget blir inaktuellt av sig självt, ifylld med `seed`. */
export function seededQueryClient(link: FakeTrpcLink, seed: (t: TrpcProxy, qc: QueryClient) => void): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY }, mutations: { retry: false } },
  });
  seed(createTRPCOptionsProxy<AppRouter>({ client: fakeTrpcClient(link.link), queryClient }), queryClient);
  return queryClient;
}

/** Renderar `ui` under den nya bindningen med förifylld cache; vägar utan svar ger ett fel. */
export function renderWithSeededTrpc(
  ui: ReactElement,
  handlers: TrpcHandlers,
  seed: (t: TrpcProxy, qc: QueryClient) => void,
  options: Omit<RenderOptions, "wrapper"> = {},
): SeededTrpcRender {
  const fake = fakeTrpcLink(handlers);
  const queryClient = seededQueryClient(fake, seed);
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcTestProvider link={fake.link} queryClient={queryClient}>{children}</TrpcTestProvider>
  );
  return { ...render(ui, { ...options, wrapper }), fake, queryClient, invalidate };
}

/** Sparade kolumnval för en lista (`prefs.get`): personliga och byråns. */
export interface ListPrefs { user: unknown; org: unknown }

/** `DataTable`s frågor i cachen: listans sparade val (inga = tomma) och den inloggade. */
export function seedDataTable(prefKey: string, prefs: ListPrefs | undefined, me: { id: string; role: string }) {
  return (t: TrpcProxy, qc: QueryClient): void => {
    seedQuery(qc, t.prefs.get.queryKey({ key: prefKey }), prefs ?? { user: null, org: null });
    seedQuery(qc, t.user.current.queryKey(), me);
  };
}
