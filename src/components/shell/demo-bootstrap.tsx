"use client";

/**
 * `DemoBootstrap` — singleton-init av DemoRuntime + offline-first-store i
 * demo-builden. Tillåter alla sidor att köra tRPC mot demo-data.
 *
 * Sedan #419 kör demon på `CachingSyncDataStore` (ADR 0016 offline-first-kärna)
 * UTAN synk-mål — `.store` (LocalStore) är datalagret, mutationer persisteras via
 * `writeBack` (slab/FSA) som förr, och kön ackumuleras lokalt men synkas aldrig.
 *
 * /demo-routen kör sin egen runtime (DemoClient → useDemoRuntime) och
 * skippas här för att undvika double-load mot OPFS.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import superjson from "superjson";
import { AnalyzeDispatcherRegistrar } from "@/components/documents/analyze-dispatcher-registrar";
import { ExtractTextDispatcherRegistrar } from "@/components/documents/extract-text-dispatcher-registrar";
import { MirrorOutlookRegistrar } from "@/components/matter/mirror-outlook-registrar";
import { RenderErrorBoundary } from "@/components/ui/render-error-boundary";
import { AuthProvider, useAuthMode } from "@/lib/client/auth/use-auth-mode";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import type { OidcLoginOutcome, OidcClaims } from "@/lib/client/backend/oidc-principal";
import { demoCacheKey } from "@/lib/client/demo/demo-cache-key";
import { DemoModeProvider } from "@/lib/client/demo/demo-mode-context";
import { demoSourceFromRuntime } from "@/lib/client/demo/demo-source-from-runtime";
import { loadFirmaConfig, patchFirmaConfig, type FirmaConfig } from "@/lib/client/firma/firma-config";
import { pickProvider } from "@/lib/client/sync/pick-provider";
import { SyncProviderRoot } from "@/lib/client/sync/sync-context";
import { trpc } from "@/lib/client/trpc";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { CachingSyncDataStore, noSyncTransport } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";
import { DemoRuntime } from "@/lib/server/local-first/demo-runtime";
import { createGhPagesCloneFn } from "@/lib/server/local-first/gh-pages-loader";
import { IndexedDbFsPersistence } from "@/lib/server/local-first/indexeddb-fs-persistence";
import type { DemoSource } from "@/lib/shared/demo-source";
import { AppShell } from "./app-shell";
import { AuthStatusBanner } from "./auth-status-banner";
import { AutoSync } from "./auto-sync";
import { JobsBadge } from "./jobs-badge";
import "@/lib/client/jobs/register-workers"; // ⚠ side-effect: registrerar workers

type Status = "loading" | "ready" | "error";

type GateDecision = "continue" | "skip-ready" | "redirect-login" | "skip-loading";

export function pathSkipsAuth(p: string): boolean {
  return /\/(demo|login)\/?$/.test(p);
}

function redirectToLogin(): void {
  const basePath = process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "";
  window.location.replace(`${basePath}/login/`);
}

/** Avgör om DemoBootstrap-useEffect ska köras vidare eller kortsluta.
 *  Bryts ut för att hålla useEffect under cyklomatisk komplexitet 8. */
export function checkBootstrapGate(firmaConfig: FirmaConfig): GateDecision {
  if (typeof window === "undefined") return "continue";
  if (pathSkipsAuth(window.location.pathname)) return "skip-ready";
  if (firmaConfig.tier === "demo" && !firmaConfig.principalId) {
    redirectToLogin();
    return "redirect-login";
  }
  if (window.location.search.includes("nodata")) return "skip-loading";
  return "continue";
}

/**
 * Mutable box som useState ger oss — refobjekt utan att triggea
 * re-render. Vi använder useState istället för useRef här för att
 * ESLint:s react-rules-of-hooks tillåter mutationer på initial value.
 */
function useRefBox<T>(initial: T): { current: T } {
  const [box] = useState<{ current: T }>(() => ({ current: initial }));
  return box;
}

type WriteBackEvent = MutationEvent<Record<string, unknown>>;

/** Returnera en skrivbar FSA-handle om en finns (self-hosted, eller demo med
 *  vald mapp). Läses fräsch ur IndexedDB — mappen kan ha valts efter mount. */
async function resolveFsaHandle(fsaRef: { current: FileSystemDirectoryHandle | null }): Promise<FileSystemDirectoryHandle | null> {
  if (fsaRef.current) return fsaRef.current;
  try {
    const { loadHandle, ensureReadWrite, isFsaSupported } = await import("@/lib/client/fsa/handle-store");
    if (!isFsaSupported()) return null;
    const loaded = await loadHandle("repo-root");
    if (loaded && (await ensureReadWrite(loaded).catch(() => false))) {
      fsaRef.current = loaded;
      return loaded;
    }
  } catch { /* faller igenom → slab */ }
  return null;
}

/** Skriv mutationen till FSA-working-copyn + notifiera AutoSync. */
async function writeViaFsa(handle: FileSystemDirectoryHandle, event: WriteBackEvent): Promise<void> {
  const { makeFsaWriteBack } = await import("@/lib/client/firma/fsa-write-back");
  await makeFsaWriteBack({ handle })(event);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ava:data-changed"));
}

/** Pure demo: skriv mutationen till den persisterade MemFs-slaben + debounced
 *  snapshot-persist (samma path-/JSON-mappning som FSA via makeWriteBack). */
async function writeViaSlab(
  rt: DemoRuntime,
  event: WriteBackEvent,
  persistTimer: { current: ReturnType<typeof setTimeout> | null },
): Promise<void> {
  const { makeWriteBack } = await import("@/lib/client/firma/fsa-write-back");
  const slabFs = {
    writeFile: (p: string, d: string) => rt.writeFile(p, d),
    unlink: (p: string) => rt.deleteFile(p),
  };
  await makeWriteBack(slabFs)(event);
  if (persistTimer.current) clearTimeout(persistTimer.current);
  persistTimer.current = setTimeout(() => { void rt.persist(); }, 600);
}

/**
 * Återfyll in-memory blob-cachen för klient-genererade dokument (kostnadsräkning
 * m.fl.) från IndexedDB efter en reload, så `openDocument`/`openGeneratedDoc`
 * (blob:-URL) fungerar igen. Endast runtime-genererat innehåll lagras här —
 * seed-dokumentens content hämtas on-demand från GH Pages (CDN-URL), så ingen
 * krock. (Ersätter den gamla MemFs-slab-rehydreringen, ADR 0016 / #420.)
 */
async function rehydrateGeneratedDocs(): Promise<void> {
  const { loadAllGeneratedDocBlobs } = await import("@/lib/client/demo/generated-doc-idb");
  const blobs = await loadAllGeneratedDocBlobs();
  if (!blobs.length) return;
  const { stashGeneratedDoc } = await import("@/lib/client/demo/generated-doc-cache");
  for (const b of blobs) stashGeneratedDoc(b.id, b.bytes, b.mimeType, b.fileName);
}

/**
 * Write-back-pipeline: muterar FSA-working-copy (self-hosted/demo-med-mapp)
 * och annars pure-demo-slaben. Returnerar writeBack + de mutable refs som
 * bootstrap-effekten fyller (persistTimer debouncar snapshot-skrivningen).
 */
function useDemoWriteBack() {
  // FSA-handle laddas async — fylls av bootstrap-effekten.
  const fsaRef = useRefBox<FileSystemDirectoryHandle | null>(null);
  // Slab-referens: writeBack skriver demo-mutationer till denna runtime:s
  // persisterade MemFs (sätts i boot-effekten).
  const runtimeRef = useRefBox<DemoRuntime | null>(null);
  const persistTimer = useRefBox<ReturnType<typeof setTimeout> | null>(null);
  const writeBack = useState(() => async (event: WriteBackEvent) => {
    // FSA-working-copy (self-hosted/demo-med-mapp) vinner; annars pure-demo-slab.
    const h = await resolveFsaHandle(fsaRef);
    if (h) { await writeViaFsa(h, event); return; }
    const rt = runtimeRef.current;
    if (rt) await writeViaSlab(rt, event, persistTimer);
  })[0];
  return { writeBack, fsaRef, runtimeRef };
}

/**
 * Lyssnar på text-extraktions-event från job-workers och skriver via writeBack-
 * pipelinen. (Genererade dokument-blobbar persisteras numera direkt till
 * IndexedDB i `persistGeneratedDoc`, ADR 0016 / #420 — inget event behövs.)
 */
function useWriteBackListeners(
  writeBack: (event: WriteBackEvent) => Promise<void>,
) {
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
}

function makeDemoQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
      mutations: { retry: false },
    },
  });
}

function createDemoTrpcClient(dataStore: IDataStore, firmaConfig: FirmaConfig) {
  return trpc.createClient({
    links: [
      new GitBackendRuntime({
        dataStore,
        authProvider: new GitAuthProvider({
          // principalId sätts av login-flowet (`/login`). Demo utan satt
          // principal → guest-id (datakällan filtrerar bort user-bundna
          // queries tills login gjorts). Self-hosted-seed:en använder
          // "current-user" tills self-hosted-login är implementerad.
          id: firmaConfig.principalId
            || (firmaConfig.tier === "self-hosted" ? "current-user" : ""),
          email: firmaConfig.authorEmail,
          name: firmaConfig.authorName,
          role: "ADMIN",
          organizationId: firmaConfig.organizationId,
        }),
      }).createLink(),
    ],
    transformer: superjson,
  } as never);
}

interface BootstrapArgs {
  firmaConfig: FirmaConfig;
  source: DemoSource;
  queryClient: QueryClient;
  fsaRef: { current: FileSystemDirectoryHandle | null };
  runtimeRef: { current: DemoRuntime | null };
  setFsaHandle: (h: FileSystemDirectoryHandle | null) => void;
  setStatus: (s: Status) => void;
  setErrorMsg: (m: string | null) => void;
  /** Self-hosted: server-first-storen + dess in-process tRPC-klient (async-byggda). */
  onStoreReady: (store: CachingSyncDataStore, client: ReturnType<typeof createDemoTrpcClient>) => void;
}

/**
 * Mount-only bootstrap: gate-check → self-hosted-clone, eller demo-slab-
 * restore/fresh-clone + FSA-handle-laddning. Fyller refs och sätter status.
 */
function useDemoBootstrap(args: BootstrapArgs) {
  const { firmaConfig, source, queryClient, fsaRef, runtimeRef, setFsaHandle, setStatus, setErrorMsg, onStoreReady } = args;
  useEffect(() => {
    const gate = checkBootstrapGate(firmaConfig);
    if (gate === "skip-ready") { queueMicrotask(() => setStatus("ready")); return; }
    if (gate === "redirect-login") return; // sidan reloadar — släng inget annat
    if (gate === "skip-loading") return;

    let cancelled = false;

    // ── Self-hosted-tier: server-first (ADR 0016, cutover #420–#422) ──
    // Bygg `createServerFirstStore` (CachingSyncDataStore synkad mot servern via
    // HTTP + IndexedDB; auth via oauth2-proxy:s samma-origin-cookie) och dess
    // in-process tRPC-klient. Ersätter iso-git-clonen i OPFS. OIDC-first-login
    // (#222/#223) bevaras: allowlisten läses ur den reconcile:ade storen.
    if (firmaConfig.tier === "self-hosted") {
      void bootstrapSelfHosted({ firmaConfig, queryClient, setStatus, setErrorMsg, onStoreReady, isCancelled: () => cancelled });
      return () => { cancelled = true; };
    }
    // Försök ladda FSA-handle innan första render. Om vi har en handle
    // som ger write-access → app:n blir writable. Annars in-memory.
    void (async () => {
      try {
        const { loadHandle, ensureReadWrite, isFsaSupported } = await import("@/lib/client/fsa/handle-store");
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
      // Demon persisterar slab-snapshotten i IndexedDB (#3) — "populera cachen
      // med demo-data" — i st.f. OPFS. Survivar reload utan OPFS-beroende.
      persistence: new IndexedDbFsPersistence(demoCacheKey()),
    });
    runtimeRef.current = runtime; // exponera slaben för writeBack (persisterad demo-skrivning)

    // Non-blocking: pre-loada text-content (.md, .txt) i bakgrunden så fritext-
    // sök matchar innehåll, inte bara metadata. Fortsätter efter "ready".
    const preloadDocs = async () => {
      try {
        const { preloadDocumentContents } = await import("@/lib/client/demo/document-content-cache");
        const { resolveGhPagesUrl } = await import("@/lib/server/local-first/gh-pages-loader");
        const baseUrl = resolveGhPagesUrl(firmaConfig.repo);
        const docs = (source.documents ?? []) as Array<{ id: string; fileName?: string; storagePath?: string; mimeType?: string }>;
        await preloadDocumentContents(docs, baseUrl);
      } catch (e) {
        console.warn("[demo] document-content preload failed:", e);
      }
    };

    void (async () => {
      try {
        // Persisterad slab (inkl. ev. runtime-mutationer) finns? Använd den och
        // klona INTE över den — annars skrivs användarens ändringar bort. Ny
        // NEXT_PUBLIC_DEMO_VERSION → ny cache-nyckel → restore ger false →
        // färsk seed-clone nedan (version-busting vid deploy).
        const restored = await runtime.restoreFromCache();
        if (restored && !cancelled) {
          mergeSource(source, demoSourceFromRuntime(runtime));
          await queryClient.invalidateQueries();
          setStatus("ready");
          void preloadDocs();
          void rehydrateGeneratedDocs();
          return;
        }
      } catch { /* fall through to fresh clone */ }

      try {
        // Första besöket (eller cache rensad/version-bytt): klona färskt seed
        // och persistera direkt så efterföljande mutationer kan läggas till
        // ovanpå och överleva reload.
        await runtime.loadDemo(firmaConfig.repo);
        if (cancelled) return;
        await runtime.persist();
        mergeSource(source, demoSourceFromRuntime(runtime));
        // Invalidate alla tRPC-queries så useQuery re-fetchar mot den
        // nu-populerade DemoDataStore.
        await queryClient.invalidateQueries();
        setStatus("ready");
        void preloadDocs();
        void rehydrateGeneratedDocs();
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
    // Mount-only bootstrap: ska köras en gång. Att lägga firmaConfig/source/
    // refs som deps skulle re-trigga hela demo-clonen; refs + queryClient är
    // stabila och behöver inte vara deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function DemoBootstrap({ children }: { children: ReactNode }) {
  const [firmaConfig] = useState<FirmaConfig>(() => loadFirmaConfig());
  // Hydrerings-grind: server-prerender och klientens FÖRSTA render måste vara
  // byte-identiska. Hela demo-appen är klient-renderad (data laddas client-side),
  // så vi renderar en minimal platshållare tills komponenten monterat — då kan
  // ingen server/klient-mismatch uppstå (React #418). Se docs/architecture.md.
  const [mounted, setMounted] = useState(false);
  const [source] = useState<DemoSource>(() => ({}));
  const [fsaHandle, setFsaHandle] = useState<FileSystemDirectoryHandle | null>(null);

  const { writeBack, fsaRef, runtimeRef } = useDemoWriteBack();
  useWriteBackListeners(writeBack);

  // Store-val per tier (ADR 0016, cutover #420–#422):
  //   • demo/github → offline-first-kärnan UTAN synk-mål (noSyncTransport),
  //     byggd synkront; `.store` är LocalStore appen läser/skriver mot.
  //   • self-hosted → server-first: `createServerFirstStore` (CachingSyncDataStore
  //     synkad mot servern via HTTP) byggs ASYNK i useDemoBootstrap → null tills
  //     den är klar (render gate:ar på trpcClient nedan).
  const isSelfHosted = firmaConfig.tier === "self-hosted";
  const [cachingSync, setCachingSync] = useState<CachingSyncDataStore | null>(() =>
    isSelfHosted ? null : CachingSyncDataStore.createEphemeral({ transport: noSyncTransport, seed: source, writeBack }),
  );
  // Initial status MÅSTE vara SSR-stabil för att undvika hydration-mismatch
  // (React #418). Pathname-baserad logik flyttas till useDemoBootstrap.
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queryClient] = useState(makeDemoQueryClient);
  const [trpcClient, setTrpcClient] = useState<ReturnType<typeof createDemoTrpcClient> | null>(() =>
    cachingSync ? createDemoTrpcClient(cachingSync.store, firmaConfig) : null,
  );

  // Flippa efter första commit → byter från platshållare till full app-tree.
  // Egen effekt (separat från boot-effekten) så hydreringen hinner committa rent.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- engångs-flip; det ÄR avsikten
  useEffect(() => { setMounted(true); }, []);

  useDemoBootstrap({
    firmaConfig, source, queryClient, fsaRef, runtimeRef, setFsaHandle, setStatus, setErrorMsg,
    onStoreReady: (store, client) => { setCachingSync(store); setTrpcClient(client); },
  });

  // Hydrerings-grind: identisk markup på server + klientens första render.
  // För self-hosted gate:ar vi även på att server-first-storen byggts (trpcClient).
  if (!mounted || !trpcClient) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-lg font-medium text-gray-900 mb-2">AVA</div>
          <div className="text-sm text-gray-500">Laddar…</div>
        </div>
      </div>
    );
  }

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
  trpcClient: ReturnType<typeof trpc.createClient>;
  queryClient: QueryClient;
  status: Status;
  errorMsg: string | null;
  fsaHandle: FileSystemDirectoryHandle | null;
  children: ReactNode;
}

function AuthGatedDemoTree(props: TreeProps) {
  const { firmaConfig, trpcClient, queryClient, status, errorMsg, fsaHandle, children } = props;
  const auth = useAuthMode();

  // readOnly avgörs av auth-mode:
  //   • demo  → alltid skrivbart (mutationer i in-memory-store; DemoModeBanner förklarar).
  //   • self-hosted (server-first) → enbart auth-mode; skrivningar går till storen
  //     + synkas till servern, ingen FSA-handle behövs (ADR 0016).
  //   • github  → kräver dessutom en FSA-handle (write-back till working-copyn).
  const isDemoTier = firmaConfig.tier === "demo";
  const readOnly = isDemoTier
    ? false
    : firmaConfig.tier === "self-hosted"
      ? auth.mode !== "identified-write"
      : (auth.mode !== "identified-write" || fsaHandle === null);

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

/** OIDC-status (#222/#223): på första self-hosted-laddningen (ingen principal
 *  bunden) hämtas claims från oauth2-proxy. `skipUser` = klona utan syntetisk
 *  currentUser (principalen bind:s efteråt istället). */
async function resolveOidcLogin(firmaConfig: FirmaConfig): Promise<{
  needsOidc: boolean; oidcClaims: OidcClaims | null; skipUser: boolean;
}> {
  const { fetchOidcClaims } = await import("@/lib/client/backend/oidc-principal");
  const needsOidc = firmaConfig.tier === "self-hosted" && !firmaConfig.principalId;
  const oidcClaims = needsOidc ? await fetchOidcClaims().catch(() => null) : null;
  return { needsOidc, oidcClaims, skipUser: needsOidc && oidcClaims != null };
}

/** Klassificera + applicera OIDC-utfallet efter klon. Returnerar true om
 *  anroparen ska avbryta (terminalt). No-op (false) utan OIDC-session. */
async function finishOidcLogin(a: {
  needsOidc: boolean; oidcClaims: OidcClaims | null; users: unknown;
  setStatus: (s: Status) => void; setErrorMsg: (m: string | null) => void;
}): Promise<boolean> {
  if (!a.needsOidc || !a.oidcClaims) return false;
  const { classifyOidcLogin } = await import("@/lib/client/backend/oidc-principal");
  const outcome = classifyOidcLogin(a.oidcClaims, (a.users ?? []) as never);
  return applyOidcOutcome(outcome, a.setStatus, a.setErrorMsg);
}

/** Fel-rapportering för loadSelfHosted-catch (no-op om laddningen avbrutits). */
function reportLoadError(
  err: unknown, isCancelled: () => boolean,
  setStatus: (s: Status) => void, setErrorMsg: (m: string | null) => void,
): void {
  if (isCancelled()) return;
  setStatus("error");
  setErrorMsg(err instanceof Error ? err.message : String(err));
}

/** Applicera OIDC-utfallet efter klon. Returnerar true om anroparen ska
 *  avbryta (terminalt): nekad → fel-status; behörig → bind principal + reload. */
function applyOidcOutcome(
  outcome: OidcLoginOutcome,
  setStatus: (s: Status) => void,
  setErrorMsg: (m: string | null) => void,
): boolean {
  if (outcome.kind === "denied") {
    setStatus("error");
    setErrorMsg(`Inte behörig: ${outcome.email} finns inte i byråns användarlista.`);
    return true;
  }
  if (outcome.kind === "authorized") {
    // Bind principalen och ladda om med rätt identitet.
    patchFirmaConfig({
      principalId: outcome.principal.id,
      authorEmail: outcome.principal.email,
      authorName: outcome.principal.name,
    });
    if (typeof window !== "undefined") window.location.reload();
    return true;
  }
  return false;
}

type SelfHostedClient = ReturnType<typeof createDemoTrpcClient>;

interface SelfHostedBootstrapArgs {
  firmaConfig: FirmaConfig;
  queryClient: QueryClient;
  setStatus: (s: Status) => void;
  setErrorMsg: (m: string | null) => void;
  onStoreReady: (store: CachingSyncDataStore, client: SelfHostedClient) => void;
  isCancelled: () => boolean;
  /** Injicerbara för test; default = riktiga server-first-storen + in-process-klienten. */
  makeStore?: () => Promise<CachingSyncDataStore>;
  makeClient?: (store: CachingSyncDataStore) => SelfHostedClient;
}

/**
 * Self-hosted server-first-bootstrap (ADR 0016, cutover #420–#422): bygg
 * `createServerFirstStore` + dess in-process tRPC-klient, bevara OIDC-first-
 * login-bindningen (allowlisten läses ur den reconcile:ade storen), och
 * signalera redo. Ersätter den gamla iso-git-OPFS-clonen. Exporterad +
 * dep-injicerbar för enhetstest (bootstrap-effekten är annars effekt-tung).
 */
async function defaultServerFirstStore(): Promise<CachingSyncDataStore> {
  const { createServerFirstStore } = await import("@/lib/client/backend/server-first-store");
  return createServerFirstStore();
}

/** OIDC-first-login-bindning för server-first: läs allowlisten ur storens klient
 *  och bind/avvisa principalen. Returnerar true om anroparen ska avbryta. No-op
 *  (false) när ingen OIDC-session pågår. */
async function bindOidcFirstLogin(a: {
  needsOidc: boolean; oidcClaims: OidcClaims | null; client: SelfHostedClient;
  setStatus: (s: Status) => void; setErrorMsg: (m: string | null) => void;
}): Promise<boolean> {
  if (!a.needsOidc) return false;
  const users = await a.client.user.list.query();
  return finishOidcLogin({ needsOidc: a.needsOidc, oidcClaims: a.oidcClaims, users, setStatus: a.setStatus, setErrorMsg: a.setErrorMsg });
}

export async function bootstrapSelfHosted(a: SelfHostedBootstrapArgs): Promise<void> {
  const { firmaConfig, queryClient, setStatus, setErrorMsg, onStoreReady, isCancelled } = a;
  const makeStore = a.makeStore ?? defaultServerFirstStore;
  const makeClient = a.makeClient ?? ((store: CachingSyncDataStore) => createDemoTrpcClient(store.store, firmaConfig));
  try {
    const { needsOidc, oidcClaims } = await resolveOidcLogin(firmaConfig);
    const store = await makeStore();
    if (isCancelled()) return;
    const client = makeClient(store);
    if (await bindOidcFirstLogin({ needsOidc, oidcClaims, client, setStatus, setErrorMsg })) return;
    if (isCancelled()) return;
    onStoreReady(store, client);
    await queryClient.invalidateQueries();
    setStatus("ready");
    // Signalera redo → SyncProviderRoot plockar om sync-provider:n.
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ava:repo-ready"));
  } catch (err) {
    reportLoadError(err, isCancelled, setStatus, setErrorMsg);
  }
}

function mergeSource(target: DemoSource, fresh: DemoSource): void {
  for (const k of Object.keys(fresh) as (keyof DemoSource)[]) {
    (target as Record<string, readonly unknown[]>)[k as string] =
      (fresh[k] ?? []) as readonly unknown[];
  }
}
