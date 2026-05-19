/**
 * `DemoProviders` — provider-stack för demo-läget.
 *
 * Komposition:
 *   - `DemoModeProvider(readOnly=true)` → komponenter ser useIsReadOnly()=true
 *   - `QueryClientProvider` + `trpc.Provider` med `createDemoTrpcLink` →
 *     alla tRPC-anrop tolkas in-process mot `DemoDataStore`
 *
 * Användning i en demo-route:
 *
 *   <DemoProviders dataStore={dataStore}>
 *     <MattersPage />
 *   </DemoProviders>
 *
 * Designval (Composition root):
 *   - Här kopplas tRPC + read-only + ev. framtida demo-only providers.
 *     Övriga delar av appen vet inget om demo-läget.
 */

"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import { createDemoTrpcLink } from "@/lib/demo/demo-trpc-link";
import { DemoModeProvider } from "@/lib/demo/demo-mode-context";
import type { IDataStore } from "@/server/data-store/IDataStore";

export interface DemoProvidersProps {
  dataStore: IDataStore;
  children: ReactNode;
}

export function DemoProviders({ dataStore, children }: DemoProvidersProps) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        // Demo-läget har ingen server att refetcha mot — disabla
        // automatiska refetches så vi inte bränner CPU på nytt.
        refetchOnWindowFocus: false,
        retry: false,
      },
      mutations: { retry: false },
    },
  }));

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [createDemoTrpcLink({ dataStore })],
      transformer: superjson,
    } as never),
  );

  return (
    <DemoModeProvider readOnly>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    </DemoModeProvider>
  );
}
