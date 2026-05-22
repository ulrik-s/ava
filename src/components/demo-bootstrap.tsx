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
import { AuthProvider, useAuthMode } from "@/lib/auth/use-auth-mode";
import { AuthStatusBanner } from "./auth-status-banner";
import { AutoSync } from "./auto-sync";
import { SyncProviderRoot } from "@/lib/sync/sync-context";
import { pickProvider } from "@/lib/sync/pick-provider";
import { JobsBadge } from "./jobs-badge";
import { AnalyzeDispatcherRegistrar } from "./analyze-dispatcher-registrar";
import "@/lib/jobs/register-workers"; // ⚠ side-effect: registrerar workers

type Status = "loading" | "ready" | "error";

/**
 * Mutable box som useState ger oss — refobjekt utan att triggea
 * re-render. Vi använder useState istället för useRef här för att
 * ESLint:s react-rules-of-hooks tillåter mutationer på initial value.
 */
function useRefBox<T>(initial: T): { current: T } {
  const [box] = useState<{ current: T }>(() => ({ current: initial }));
  return box;
}

export function DemoBootstrap({ children }: { children: ReactNode }) {
  const [firmaConfig] = useState<FirmaConfig>(() => loadFirmaConfig());
  const [source] = useState<DemoSource>(() => ({}));
  const [fsaHandle, setFsaHandle] = useState<FileSystemDirectoryHandle | null>(null);
  // FSA-handle laddas async — uppdatera mutable container via setHandle
  // som även triggar React-state och stänger ESLint:s ref-during-render.
  const fsaRef = useRefBox<FileSystemDirectoryHandle | null>(null);
  const writeBack = useState(() => async (event: { entity: string; kind: string; row: Record<string, unknown>; previous?: Record<string, unknown> }) => {
    // Läs handle:n FRÄSCH från IndexedDB vid varje skrivning. fsaRef
    // sätts av bootstrap:s useEffect men användaren kan ha valt
    // FSA-mappen via /settings EFTER bootstrap mounted — då är
    // fsaRef.current null men handle:n finns i IndexedDB. Att alltid
    // läsa fresh undviker den racen helt.
    let h = fsaRef.current;
    if (!h) {
      try {
        const { loadHandle, ensureReadWrite, isFsaSupported } = await import("@/lib/fsa/handle-store");
        if (!isFsaSupported()) return;
        const loaded = await loadHandle("repo-root");
        if (!loaded) return;
        if (!(await ensureReadWrite(loaded).catch(() => false))) return;
        h = loaded;
        fsaRef.current = loaded; // cache:a för nästa anrop
      } catch { return; }
    }
    const { makeFsaWriteBack } = await import("@/lib/firma/fsa-write-back");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await makeFsaWriteBack({ handle: h })(event as any);
    // Notifiera AutoSync — debounced push triggas
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ava:data-changed"));
    }
  })[0];
  const [dataStore] = useState(() => new DemoDataStore(source, writeBack));
  // Initial status MÅSTE vara SSR-stabil för att undvika hydration-
  // mismatch (React #418). Pathname-baserad logik flyttas till useEffect.
  const [status, setStatus] = useState<Status>("loading");
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
    // /demo har egen runtime (DemoClient). /settings är konfig-sidan
    // som inte behöver demo-data. Båda skippar load + visar inte
    // loading-overlay.
    if (typeof window !== "undefined") {
      const p = window.location.pathname;
      if (p.endsWith("/demo") || p.endsWith("/demo/")
          || p.endsWith("/settings") || p.endsWith("/settings/")
          || p.endsWith("/profile") || p.endsWith("/profile/")
          || p.endsWith("/users") || p.endsWith("/users/")
          || p.endsWith("/jobs") || p.endsWith("/jobs/")) {
        queueMicrotask(() => setStatus("ready"));
        return;
      }
    }

    // Debug-flagga: ?nodata = ladda inte, behåll status=loading
    if (typeof window !== "undefined" && window.location.search.includes("nodata")) {
      return;
    }

    let cancelled = false;
    // Försök ladda FSA-handle innan första render. Om vi har en handle
    // som ger write-access → app:n blir writable. Annars in-memory.
    void (async () => {
      try {
        const { loadHandle, ensureReadWrite, isFsaSupported } = await import("@/lib/fsa/handle-store");
        if (!isFsaSupported()) return;
        const h = await loadHandle("repo-root");
        if (!h) return;
        const ok = await ensureReadWrite(h).catch(() => false);
        if (!ok) return;
        if (cancelled) return;
        fsaRef.current = h;
        setFsaHandle(h);
      } catch { /* ignorera */ }
    })();

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
    <AuthProvider token={firmaConfig.token} repoUrl={firmaConfig.repo}>
      <AuthGatedDemoTree
        firmaConfig={firmaConfig}
        trpcClient={trpcClient}
        queryClient={queryClient}
        status={status}
        errorMsg={errorMsg}
        fsaHandle={fsaHandle}
      >
        {children}
      </AuthGatedDemoTree>
    </AuthProvider>
  );
}

interface TreeProps {
  firmaConfig: FirmaConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trpcClient: any;
  queryClient: QueryClient;
  status: Status;
  errorMsg: string | null;
  fsaHandle: FileSystemDirectoryHandle | null;
  children: ReactNode;
}

function AuthGatedDemoTree(props: TreeProps) {
  const { firmaConfig, trpcClient, queryClient, status, errorMsg, fsaHandle, children } = props;
  const auth = useAuthMode();

  // readOnly avgörs av auth-mode. FSA-handle krävs fortfarande för att
  // write faktiskt ska landa på disk; om vi saknar handle visar vi UI:n
  // som write-mode men sync-pillen kommer berätta att inget skrivs.
  const readOnly = auth.mode !== "identified-write" || fsaHandle === null;

  return (
    <DemoModeProvider readOnly={readOnly}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <SyncProviderRoot token={firmaConfig.token} pickProvider={pickProvider}>
          <AnalyzeDispatcherRegistrar />
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white">
            <div className="flex-1 min-w-0">
              <AuthStatusBanner />
            </div>
            <div className="px-3 py-1.5 shrink-0 flex items-center gap-2">
              <JobsBadge />
              <AutoSync />
            </div>
          </div>
          {status === "loading" && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
              <div className="text-center">
                <div className="text-lg font-medium text-gray-900 mb-2">AVA</div>
                <div className="text-sm text-gray-500">Laddar data…</div>
                <a
                  href="/settings"
                  className="mt-4 inline-block text-xs text-blue-600 hover:underline"
                >
                  Öppna inställningar
                </a>
              </div>
            </div>
          )}
          {status === "error" && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
              <div className="text-center max-w-md p-6">
                <div className="text-lg font-medium text-red-900 mb-2">Kunde inte ladda data</div>
                <div className="text-sm text-red-600 mb-4">{errorMsg}</div>
                <a
                  href="/settings"
                  className="inline-block px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Öppna inställningar
                </a>
              </div>
            </div>
          )}
          <RenderErrorBoundary>{children}</RenderErrorBoundary>
          </SyncProviderRoot>
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
