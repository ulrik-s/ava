/**
 * Testhjälpare för den nya tRPC-bindningen (ADR 0041, #1926).
 *
 * `fakeTrpcLink(handlers)` svarar per procedurväg ur en karta och sparar
 * anropen. `TrpcTestProvider` ger en riktig QueryClient (`retry: false`) med
 * `TRPCProvider`, så att komponenter som skriver `useTRPC()` kan testas utan
 * store. Förebild för länken: `backend-runtime-pluggability.test.ts`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError, type TRPCClient, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { useState, type ReactNode } from "react";
import { TRPCProvider } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";

/** Ett svar per procedurväg (`"matter.list"`), givet anropets input. */
export type TrpcHandlers = Readonly<Record<string, (input: unknown) => unknown>>;

/** Ett anrop som länken har tagit emot. */
export interface TrpcCall {
  path: string;
  type: "query" | "mutation" | "subscription";
  input: unknown;
}

/** En länk med anropsloggen. */
export interface FakeTrpcLink {
  link: TRPCLink<AppRouter>;
  calls: TrpcCall[];
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** Länk som svarar ur `handlers`; en väg utan svar ger ett fel. */
export function fakeTrpcLink(handlers: TrpcHandlers): FakeTrpcLink {
  const calls: TrpcCall[] = [];
  const link: TRPCLink<AppRouter> = () => ({ op }) =>
    observable((observer) => {
      calls.push({ path: op.path, type: op.type, input: op.input });
      const handler = handlers[op.path];
      if (!handler) {
        observer.error(TRPCClientError.from<AppRouter>(new Error(`inget svar för ${op.path}`)));
        return () => {};
      }
      Promise.resolve(handler(op.input)).then(
        (data) => { observer.next({ result: { data } }); observer.complete(); },
        (err: unknown) => observer.error(TRPCClientError.from<AppRouter>(toError(err))),
      );
      return () => {};
    });
  return { link, calls };
}

/** En tRPC-klient över en enda länk, t.ex. `fakeTrpcLink(…).link`. */
export function fakeTrpcClient(link: TRPCLink<AppRouter>): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [link] });
}

/** QueryClient för tester: inga omförsök, så att fel syns direkt. */
export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/** Providern för komponenter som skriver `useTRPC()`. */
export function TrpcTestProvider(props: {
  link: TRPCLink<AppRouter>;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => props.queryClient ?? testQueryClient());
  const [trpcClient] = useState(() => fakeTrpcClient(props.link));
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {props.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

/** En spion på `queryClient.invalidateQueries` (`vi.spyOn`). */
export interface InvalidateSpy { mock: { calls: ReadonlyArray<readonly unknown[]> } }

function queryKeyOf(filter: unknown): readonly unknown[] {
  if (typeof filter !== "object" || filter === null || !("queryKey" in filter)) return [];
  return Array.isArray(filter.queryKey) ? filter.queryKey : [];
}

function inputOf(meta: unknown): unknown {
  return typeof meta === "object" && meta !== null && "input" in meta ? meta.input : undefined;
}

/**
 * Procedurvägarna som invaliderats, sorterade, t.ex. `"watchlist.list"` eller
 * `"matter.getById {"id":"m1"}"` när filtret har input.
 */
export function invalidatedPaths(spy: InvalidateSpy): string[] {
  return spy.mock.calls.map((c) => {
    const key = queryKeyOf(c[0]);
    const path = Array.isArray(key[0]) ? key[0].join(".") : "";
    const input = inputOf(key[1]);
    return input === undefined ? path : `${path} ${JSON.stringify(input)}`;
  }).sort();
}
