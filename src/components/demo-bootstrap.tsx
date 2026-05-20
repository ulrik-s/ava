"use client";

/**
 * `DemoBootstrap` — singleton-init av DemoRuntime + DemoDataStore i
 * demo-builden. Tillåter alla sidor att köra tRPC mot demo-data.
 *
 * /demo-routen kör sin egen runtime (DemoClient → useDemoRuntime) och
 * skippas här för att undvika double-load mot OPFS.
 */

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import { RenderErrorBoundary } from "./render-error-boundary";
import { DemoRuntime } from "@/server/local-first/demo-runtime";
import { createGhPagesCloneFn } from "@/server/local-first/gh-pages-loader";
import { OpfsPersistence } from "@/server/local-first/persistence";
import { DemoDataStore, type DemoSource } from "@/server/data-store/DemoDataStore";
import { createDemoTrpcLink } from "@/lib/demo/demo-trpc-link";
import { DemoModeProvider } from "@/lib/demo/demo-mode-context";
import { demoSourceFromRuntime } from "@/lib/demo/demo-source-from-runtime";
import { trpc } from "@/lib/trpc";
import { loadFirmaConfig, type FirmaConfig } from "@/lib/firma/firma-config";
import { FirmaSettingsPanel } from "./firma-settings-panel";

type Status = "loading" | "ready" | "error";

export function DemoBootstrap({ children }: { children: ReactNode }) {
  const [firmaConfig] = useState<FirmaConfig>(() => loadFirmaConfig());
  const [showSettings, setShowSettings] = useState(false);
  const [source] = useState<DemoSource>(() => ({}));
  const [dataStore] = useState(() => new DemoDataStore(source));
  // På /demo har vi ingen runtime-load → starta som "ready" så vi inte
  // kallar setStatus i effect:n (vilket React 19 ogillar).
  const initialStatus: Status = typeof window !== "undefined"
    && (window.location.pathname.endsWith("/demo") || window.location.pathname.endsWith("/demo/"))
    ? "ready" : "loading";
  const [status, setStatus] = useState<Status>(initialStatus);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
      mutations: { retry: false },
    },
  }));
  const [trpcClient] = useState(() => trpc.createClient({
    links: [createDemoTrpcLink({
      dataStore,
      user: {
        id: "current-user",
        email: firmaConfig.authorEmail,
        name: firmaConfig.authorName,
        role: "ADMIN",
        organizationId: firmaConfig.organizationId,
      },
    })],
    transformer: superjson,
  } as never));

  useEffect(() => {
    // /demo har egen runtime (DemoClient) — skipa bootstrappens load.
    if (typeof window !== "undefined") {
      const p = window.location.pathname;
      if (p.endsWith("/demo") || p.endsWith("/demo/")) return; // status redan "ready"
    }

    // Debug-flagga: ?nodata = ladda inte, behåll status=loading
    if (typeof window !== "undefined" && window.location.search.includes("nodata")) {
      return;
    }

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
          await queryClient.invalidateQueries();
          setStatus("ready");
        }
      } catch { /* fall through */ }

      try {
        await runtime.loadDemo(firmaConfig.repo);
        if (cancelled) return;
        mergeSource(source, demoSourceFromRuntime(runtime));
        // Invalidate alla tRPC-queries så useQuery re-fetchar mot
        // den nu-populerade DemoDataStore.
        await queryClient.invalidateQueries();
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
          {showSettings && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-auto">
              <FirmaSettingsPanel
                initial={firmaConfig}
                onSaved={() => window.location.reload()}
                onCancel={() => setShowSettings(false)}
              />
            </div>
          )}
          {status === "loading" && !showSettings && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
              <div className="text-center">
                <div className="text-lg font-medium text-gray-900 mb-2">AVA</div>
                <div className="text-sm text-gray-500">Laddar data från {firmaConfig.repo}…</div>
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="mt-4 text-xs text-blue-600 hover:underline"
                >
                  Byt firma / datakälla
                </button>
              </div>
            </div>
          )}
          {status === "error" && !showSettings && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
              <div className="text-center max-w-md p-6">
                <div className="text-lg font-medium text-red-900 mb-2">Kunde inte ladda data</div>
                <div className="text-sm text-red-600 mb-4">{errorMsg}</div>
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Byt firma / datakälla
                </button>
              </div>
            </div>
          )}
          <RenderErrorBoundary>{children}</RenderErrorBoundary>
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
