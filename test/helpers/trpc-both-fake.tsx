/**
 * Båda tRPC-bindningarna över en falsk länk (ADR 0041, #1929).
 *
 * En flyttad komponent (`useTRPC()`) kan rendera barn som fortfarande läser den
 * klassiska `trpc` (t.ex. `DataTable`, `ClientPickerDialog`). `TrpcTestProvider`
 * ger bara den nya bindningen; här monteras appens egna `TrpcProviders` med
 * `fakeTrpcLink`, så att båda bindningarna svarar ur samma karta och delar
 * QueryClient — utan `vi.mock` av `@/lib/client/trpc`.
 */

import type { QueryClient } from "@tanstack/react-query";
import { render, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { expect, vi } from "vitest-compat";
import { TrpcProviders } from "@/components/shell/trpc-providers";
import { fakeTrpcClient, fakeTrpcLink, testQueryClient, type FakeTrpcLink, type InvalidateSpy, type TrpcHandlers } from "./trpc-fake";

/** Det en rendering ger: anropsloggen, spionen på invalideringar och renderingen. */
export interface FakeTrpcRender extends RenderResult {
  fake: FakeTrpcLink;
  /** Spion på `queryClient.invalidateQueries`; läs med `invalidatedPaths`. */
  invalidate: InvalidateSpy;
  /** QueryClienten båda bindningarna delar. */
  queryClient: QueryClient;
}

/**
 * Renderar `ui` under båda bindningarna; vägar utan svar ger ett fel. Providern
 * är en `wrapper`, så att `rerender(ui)` behåller den.
 */
export function renderWithFakeTrpc(ui: ReactElement, handlers: TrpcHandlers): FakeTrpcRender {
  const fake = fakeTrpcLink(handlers);
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const trpcClient = fakeTrpcClient(fake.link);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcProviders trpcClient={trpcClient} queryClient={queryClient}>{children}</TrpcProviders>
  );
  const view = render(ui, { wrapper });
  return { ...view, fake, invalidate, queryClient };
}

/** Väntar tills inga frågor eller ändringar pågår (t.ex. efter första hämtningen). */
export async function settled(view: { queryClient: QueryClient }): Promise<void> {
  await waitFor(() => expect(view.queryClient.isFetching() + view.queryClient.isMutating()).toBe(0));
}

/** Anropen till en procedurväg, i ordning: bara deras input. */
export function callsTo(fake: FakeTrpcLink, path: string): unknown[] {
  return fake.calls.filter((c) => c.path === path).map((c) => c.input);
}

/** Svaren `DataTable` läser (sparade kolumnval och inloggad användare): inga val, ingen admin. */
export const DATA_TABLE_HANDLERS: TrpcHandlers = {
  "prefs.get": () => ({ user: null, org: null }),
  "user.current": () => ({ id: "u1", name: "Anna", role: "LAWYER" }),
};
