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
import { createDemoTrpcLink } from "@/client/lib/demo/demo-trpc-link";
import { DemoModeProvider } from "@/client/lib/demo/demo-mode-context";
import { demoSourceFromRuntime } from "@/client/lib/demo/demo-source-from-runtime";
import { trpc } from "@/client/lib/trpc";
import { loadFirmaConfig, type FirmaConfig } from "@/client/lib/firma/firma-config";
import { AuthProvider, useAuthMode } from "@/client/lib/auth/use-auth-mode";
import { AuthStatusBanner } from "./auth-status-banner";
import { AutoSync } from "./auto-sync";
import { SyncProviderRoot } from "@/client/lib/sync/sync-context";
import { pickProvider } from "@/client/lib/sync/pick-provider";
import { JobsBadge } from "./jobs-badge";
import { AnalyzeDispatcherRegistrar } from "./analyze-dispatcher-registrar";
import { ExtractTextDispatcherRegistrar } from "./extract-text-dispatcher-registrar";
import { MirrorOutlookRegistrar } from "./mirror-outlook-registrar";
import { AppShell } from "./app-shell";
import "@/client/lib/jobs/register-workers"; // ⚠ side-effect: registrerar workers

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
        const { loadHandle, ensureReadWrite, isFsaSupported } = await import("@/client/lib/fsa/handle-store");
        if (!isFsaSupported()) return;
        const loaded = await loadHandle("repo-root");
        if (!loaded) return;
        if (!(await ensureReadWrite(loaded).catch(() => false))) return;
        h = loaded;
        fsaRef.current = loaded; // cache:a för nästa anrop
      } catch { return; }
    }
    const { makeFsaWriteBack } = await import("@/client/lib/firma/fsa-write-back");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await makeFsaWriteBack({ handle: h })(event as any);
    // Notifiera AutoSync — debounced push triggas
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ava:data-changed"));
    }
  })[0];

  // Lyssna på text-extraktions-event från job-workers. Skriver via
  // samma writeBack-pipeline så filen hamnar i FSA + auto-sync push:ar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ documentId: string; text: string }>).detail;
      if (!detail) return;
      void writeBack({
        entity: "documentText",
        kind: "create",
        row: { id: detail.documentId, text: detail.text },
      });
    };
    window.addEventListener("ava:document-text-extracted", handler);
    return () => window.removeEventListener("ava:document-text-extracted", handler);
  }, [writeBack]);

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
    // /demo har egen runtime (DemoClient) → skippa loadern. Övriga "configurations-
    // sidor" (/settings, /users, /profile, /jobs) behöver source-data:
    // /settings läser org-raden, /users läser user-listan etc. Hoppa ALDRIG
    // över laddningen för dem — annars throw:ar getSettings/list.
    if (typeof window !== "undefined") {
      const p = window.location.pathname;
      if (p.endsWith("/demo") || p.endsWith("/demo/")) {
        queueMicrotask(() => setStatus("ready"));
        return;
      }
    }

    // Debug-flagga: ?nodata = ladda inte, behåll status=loading
    if (typeof window !== "undefined" && window.location.search.includes("nodata")) {
      return;
    }

    let cancelled = false;

    // ── Self-hosted-tier: klona repo:t in i OPFS + hydrera därifrån ──
    // (egen git-server, t.ex. docker:8080/git eller firma-Linux-låda).
    // OPFS kräver ingen mapp-dialog → fungerar headless (e2e) + iOS.
    if (firmaConfig.tier === "self-hosted") {
      void loadSelfHosted(firmaConfig, source, queryClient, fsaRef, setFsaHandle, setStatus, setErrorMsg, () => cancelled);
      return () => { cancelled = true; };
    }
    // Försök ladda FSA-handle innan första render. Om vi har en handle
    // som ger write-access → app:n blir writable. Annars in-memory.
    void (async () => {
      try {
        const { loadHandle, ensureReadWrite, isFsaSupported } = await import("@/client/lib/fsa/handle-store");
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

        // Pre-loada text-content (.md, .txt) i bakgrunden så fritextsök
        // matchar mot innehåll, inte bara metadata. PDF kommer i nästa
        // iteration via pdfjs-dist. Non-blocking: fortsätter efter ready.
        void (async () => {
          try {
            const { preloadDocumentContents } = await import("@/client/lib/demo/document-content-cache");
            const { resolveGhPagesUrl } = await import("@/server/local-first/gh-pages-loader");
            const baseUrl = resolveGhPagesUrl(firmaConfig.repo);
            const docs = (source.documents ?? []) as Array<{ id: string; fileName?: string; storagePath?: string; mimeType?: string }>;
            await preloadDocumentContents(docs, baseUrl);
          } catch (e) {
            console.warn("[demo] document-content preload failed:", e);
          }
        })();
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
          <ExtractTextDispatcherRegistrar />
          <MirrorOutlookRegistrar />
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
          <RenderErrorBoundary>
            <AppShell>{children}</AppShell>
          </RenderErrorBoundary>
          </SyncProviderRoot>
        </QueryClientProvider>
      </trpc.Provider>
    </DemoModeProvider>
  );
}

/**
 * Self-hosted-laddning: hämta OPFS-working-copy, klona repo:t in (om ej
 * redan), hydrera DemoSource från clonen. Skrivningar + sync sköts av
 * samma FSA-pipeline (OPFS-handle:n sparas som "repo-root").
 */
// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async function 'loadSelfHosted' has a complexity of 9. Maximum allowed is 8.)
async function loadSelfHosted(
  firmaConfig: FirmaConfig,
  source: DemoSource,
  queryClient: QueryClient,
  fsaRef: { current: FileSystemDirectoryHandle | null },
  setFsaHandle: (h: FileSystemDirectoryHandle | null) => void,
  setStatus: (s: Status) => void,
  setErrorMsg: (m: string | null) => void,
  isCancelled: () => boolean,
): Promise<void> {
  try {
    const { getOpfsRoot, saveHandle } = await import("@/client/lib/fsa/handle-store");
    const { loadSelfHostedSource } = await import("@/client/lib/firma/load-self-hosted-source");
    const opfs = await getOpfsRoot("working-copy");
    if (!opfs) {
      setStatus("error");
      setErrorMsg("OPFS stöds inte i denna webbläsare — self-hosted-läget kräver det.");
      return;
    }
    await saveHandle("repo-root", opfs); // så write-back + pick-provider hittar samma handle
    fsaRef.current = opfs;
    if (!isCancelled()) setFsaHandle(opfs);

    const origin = typeof window !== "undefined" ? window.location.origin : undefined;
    const src = await loadSelfHostedSource({
      handle: opfs,
      repo: firmaConfig.repo,
      token: firmaConfig.token,
      origin,
      // Måste matcha trpcClient-användaren nedan (id "current-user") så att
      // flöden som slår upp ctx.user (timeEntry.create m.fl.) hittar en rad.
      currentUser: {
        id: "current-user",
        email: firmaConfig.authorEmail,
        name: firmaConfig.authorName,
        organizationId: firmaConfig.organizationId,
      },
    });
    if (isCancelled()) return;
    mergeSource(source, src);
    await queryClient.invalidateQueries();
    setStatus("ready");
    // Signalera att working copy + handle är redo → SyncProviderRoot
    // plockar om sync-provider:n (den kördes på mount innan handle:n fanns).
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ava:repo-ready"));
  } catch (err) {
    if (isCancelled()) return;
    setStatus("error");
    setErrorMsg(err instanceof Error ? err.message : String(err));
  }
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
