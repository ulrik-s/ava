"use client";

/**
 * `DemoBootstrap` — singleton-init av DemoRuntime + DemoDataStore i
 * demo-builden, så hela appens tRPC-anrop går mot demo-data.
 *
 * Designval (Composition root):
 *   - Här samlas: DemoRuntime (med GH Pages-loader + OPFS), DemoSource
 *     (mutable container som uppdateras vid load), DemoDataStore, och
 *     en tRPC-länk som routar genom appRouter.createCaller.
 *
 * Designval (Lazy/reactive):
 *   - DemoSource är en mutable referens — när runtime:n hydratiserat
 *     entiteterna pekar source:n direkt på dem. DemoDataStore läser
 *     source[key] vid varje query → följer med live.
 *
 * Designval (UX):
 *   - Visar "Laddar demo-data…"-overlay tills första loaden klar.
 */

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import { DemoRuntime } from "@/server/local-first/demo-runtime";
import { createGhPagesCloneFn } from "@/server/local-first/gh-pages-loader";
import { OpfsPersistence } from "@/server/local-first/persistence";
import { DemoDataStore, type DemoSource } from "@/server/data-store/DemoDataStore";
import { createDemoTrpcLink } from "@/lib/demo/demo-trpc-link";
import { DemoModeProvider } from "@/lib/demo/demo-mode-context";
import { demoSourceFromRuntime } from "@/lib/demo/demo-source-from-runtime";
import { trpc } from "@/lib/trpc";

const DEFAULT_DEMO_REPO =
  process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO ?? "ulrik-s/ava-demo";

type Status = "loading" | "ready" | "error";

export function DemoBootstrap({ children }: { children: ReactNode }) {
  // Mutable source-objekt + DataStore byggs en gång via useState (lazy).
  // DataStore läser source[key] vid varje query, så när effect mutar
  // source:n följer queries med utan att DataStore behöver byggas om.
  const [source] = useState<DemoSource>(() => ({}));
  const [dataStore] = useState(() => new DemoDataStore(source));
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
      mutations: { retry: false },
    },
  }));
  const [trpcClient] = useState(() => trpc.createClient({
    links: [createDemoTrpcLink({ dataStore })],
    transformer: superjson,
  } as never));

  useEffect(() => {
    let cancelled = false;
    const runtime = DemoRuntime.create({
      cloneFn: createGhPagesCloneFn(),
      persistence: new OpfsPersistence("ava-demo"),
    });
    (async () => {
      try {
        const restored = await runtime.restoreFromCache();
        if (restored && !cancelled) {
          mergeSource(source, demoSourceFromRuntime(runtime));
          setStatus("ready");
        }
      } catch { /* fall through till load */ }

      try {
        await runtime.loadDemo(DEFAULT_DEMO_REPO);
        if (cancelled) return;
        mergeSource(source, demoSourceFromRuntime(runtime));
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <DemoModeProvider readOnly>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {status === "loading" && <Overlay tone="info">Laddar demo-data från GitHub…</Overlay>}
          {status === "error" && <Overlay tone="error"><strong>Kunde inte ladda demo-data:</strong> {errorMsg}</Overlay>}
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    </DemoModeProvider>
  );
}

function mergeSource(target: DemoSource, fresh: DemoSource): void {
  for (const k of Object.keys(fresh) as (keyof DemoSource)[]) {
    (target as Record<string, readonly unknown[]>)[k as string] =
      (fresh[k] ?? []) as readonly unknown[];
  }
}

function Overlay({ tone, children }: { tone: "info" | "error"; children: ReactNode }) {
  const cls = tone === "error"
    ? "bg-red-50 border-b border-red-200 text-red-800"
    : "bg-blue-50 border-b border-blue-200 text-blue-800";
  return (
    <div className={`fixed top-0 left-0 right-0 z-50 ${cls} text-sm py-2 px-4 text-center`}>
      {children}
    </div>
  );
}
