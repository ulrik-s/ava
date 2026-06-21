"use client";

/**
 * `DemoBootstrap` — singleton-init av offline-first-store + tRPC-klient i
 * demo-builden. Tillåter alla sidor att köra tRPC mot demo-data.
 *
 * Sedan #420 (ADR 0016) kör demon på en **persisterad** `CachingSyncDataStore`;
 * sedan #544 (ADR 0025) hydreras cachen via den riktiga reconcile/pull-vägen mot
 * en serverlös `StaticSyncSource`:
 *   - första besök/cache-miss: `createDemoStore` laddar EN bundlad `demo-seed.json`
 *     och `reconcile()` pull:ar in den (samma apply-väg som riktiga klienten).
 *   - `persistence` (IndexedDB) + `queuePersistence` (IndexedDB) cachar source:n
 *     och mutations-kön → efterföljande besök hydreras direkt ur snapshotet.
 *     Mutationer persisteras automatiskt (snapshot) → överlever reload.
 *
 * /demo-routen kör sin egen runtime (DemoClient → useDemoSeed).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import superjson from "superjson";
import { AnalyzeDispatcherRegistrar } from "@/components/documents/analyze-dispatcher-registrar";
import { ExtractTextDispatcherRegistrar } from "@/components/documents/extract-text-dispatcher-registrar";
import { MirrorOutlookRegistrar } from "@/components/matter/mirror-outlook-registrar";
import { RenderErrorBoundary } from "@/components/ui/render-error-boundary";
import { AuthProvider, useAuthMode } from "@/lib/client/auth/use-auth-mode";
import { createDemoStore } from "@/lib/client/backend/create-demo-store";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import type { OidcLoginOutcome, OidcClaims } from "@/lib/client/backend/oidc-principal";
import { StaticContentStore } from "@/lib/client/backend/static-content-store";
import { CapabilitiesProvider } from "@/lib/client/capabilities/use-capabilities";
import { DemoModeProvider } from "@/lib/client/demo/demo-mode-context";
import { loadFirmaConfig, patchFirmaConfig, type FirmaConfig } from "@/lib/client/firma/firma-config";
import { SyncProviderRoot } from "@/lib/client/sync/sync-context";
import { trpc } from "@/lib/client/trpc";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import type { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { resolveGhPagesUrl } from "@/lib/shared/gh-pages-url";
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

function makeDemoQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
      mutations: { retry: false },
    },
  });
}

function createDemoTrpcClient(dataStore: IDataStore, firmaConfig: FirmaConfig) {
  // Content-porten serverar de bundlade dokument-blobbarna (#545, ADR 0025) så
  // `document.downloadContent` → byte-cachen funkar i demon, via SAMMA
  // IContentStore-söm som GitContentStore server-side (noopContentStore gav
  // `read → null` → seed-dokument gick aldrig att öppna).
  const ports = {
    ...buildGitPorts(dataStore),
    content: new StaticContentStore(resolveGhPagesUrl(firmaConfig.repo)),
  };
  return trpc.createClient({
    links: [
      new GitBackendRuntime({
        dataStore,
        ports,
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
  queryClient: QueryClient;
  setStatus: (s: Status) => void;
  setErrorMsg: (m: string | null) => void;
  /** Storen + dess in-process tRPC-klient (async-byggda, per tier). */
  onStoreReady: (store: CachingSyncDataStore, client: ReturnType<typeof createDemoTrpcClient>) => void;
}

/**
 * Non-blocking: pre-loada text-content (.md, .txt) i bakgrunden så fritext-sök
 * matchar innehåll, inte bara metadata. Fortsätter efter "ready".
 */
async function preloadDocs(firmaConfig: FirmaConfig, store: CachingSyncDataStore): Promise<void> {
  try {
    const { preloadDocumentContents } = await import("@/lib/client/demo/document-content-cache");
    const { resolveGhPagesUrl } = await import("@/lib/shared/gh-pages-url");
    const baseUrl = resolveGhPagesUrl(firmaConfig.repo);
    const source = store.store.currentSource as { documents?: Array<{ id: string; fileName?: string; storagePath?: string; mimeType?: string }> };
    await preloadDocumentContents(source.documents ?? [], baseUrl);
  } catch (e) {
    console.warn("[demo] document-content preload failed:", e);
  }
}

/**
 * Mount-only bootstrap: gate-check → self-hosted-store (server-first) eller
 * demo/github-store (persisterad offline-first-kärna + GH-Pages-seed).
 */
function useDemoBootstrap(args: BootstrapArgs) {
  const { firmaConfig, queryClient, setStatus, setErrorMsg, onStoreReady } = args;
  useEffect(() => {
    const gate = checkBootstrapGate(firmaConfig);
    if (gate === "skip-ready") { queueMicrotask(() => setStatus("ready")); return; }
    if (gate === "redirect-login") return; // sidan reloadar — släng inget annat
    if (gate === "skip-loading") return;

    let cancelled = false;

    // ── Self-hosted-tier: server-first (ADR 0016, cutover #420–#422) ──
    if (firmaConfig.tier === "self-hosted") {
      void bootstrapSelfHosted({ firmaConfig, queryClient, setStatus, setErrorMsg, onStoreReady, isCancelled: () => cancelled });
      return () => { cancelled = true; };
    }

    // ── demo/github-tier: persisterad offline-first-kärna utan synk-mål ──
    // `createDemoStore` hydrerar IndexedDB-cachen om den finns, annars laddas
    // den bundlade `demo-seed.json` in via reconcile/pull (ADR 0025).
    void (async () => {
      try {
        const store = await createDemoStore(firmaConfig);
        if (cancelled) return;
        const client = createDemoTrpcClient(store.store, firmaConfig);
        onStoreReady(store, client);
        await queryClient.invalidateQueries();
        setStatus("ready");
        void preloadDocs(firmaConfig, store);
        void rehydrateGeneratedDocs();
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
    // Mount-only bootstrap: ska köras en gång. firmaConfig/queryClient är stabila.
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

  // Storen byggs ASYNK i useDemoBootstrap (cache-hydrering + ev. GH-Pages-fetch)
  // → null tills den är klar; render gate:ar på trpcClient nedan.
  const [, setCachingSync] = useState<CachingSyncDataStore | null>(null);
  // Initial status MÅSTE vara SSR-stabil för att undvika hydration-mismatch
  // (React #418). Pathname-baserad logik flyttas till useDemoBootstrap.
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queryClient] = useState(makeDemoQueryClient);
  const [trpcClient, setTrpcClient] = useState<ReturnType<typeof createDemoTrpcClient> | null>(null);

  // Flippa efter första commit → byter från platshållare till full app-tree.
  // Egen effekt (separat från boot-effekten) så hydreringen hinner committa rent.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- engångs-flip; det ÄR avsikten
  useEffect(() => { setMounted(true); }, []);

  useDemoBootstrap({
    firmaConfig, queryClient, setStatus, setErrorMsg,
    // OBS: tRPC-klienten är ett ANROPBART proxy-objekt → `setState(client)`
    // skulle tolkas som en updater-funktion (`setState(prev => client(prev))`)
    // och aldrig lagra klienten. Sätt via en wrapper-funktion (`() => x`).
    onStoreReady: (store, client) => { setCachingSync(() => store); setTrpcClient(() => client); },
  });

  // Hydrerings-grind: identisk markup på server + klientens första render.
  if (!mounted) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-lg font-medium text-gray-900 mb-2">AVA</div>
          <div className="text-sm text-gray-500">Laddar…</div>
        </div>
      </div>
    );
  }

  // Skip-auth-sidor (/login, /demo) bygger ALDRIG en demo-store/trpc-klient
  // (skip-ready-gaten i useDemoBootstrap returnerar tidigt). De renderar sitt
  // eget innehåll utan datakällan → gate:a INTE på trpcClient, annars fastnar
  // de för evigt på "AVA Laddar…" (regression från #498:s !trpcClient-gate; en
  // ny besökare utan principalId dirigeras till /login och kunde inte logga in).
  if (pathSkipsAuth(window.location.pathname)) {
    return <>{children}</>;
  }

  // Data-sidor väntar på att storen byggts.
  if (!trpcClient) {
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
  children: ReactNode;
}

function AuthGatedDemoTree(props: TreeProps) {
  const { firmaConfig, trpcClient, queryClient, status, errorMsg, children } = props;
  const auth = useAuthMode();

  // readOnly avgörs av auth-mode:
  //   • demo  → alltid skrivbart (mutationer i den persisterade storen; DemoModeBanner förklarar).
  //   • self-hosted/github (server-first/offline-first) → enbart auth-mode; skrivningar
  //     går till storen (+ ev. synk till servern), ingen FSA-handle behövs (ADR 0016).
  const isDemoTier = firmaConfig.tier === "demo";
  const readOnly = isDemoTier ? false : auth.mode !== "identified-write";

  return (
    <DemoModeProvider readOnly={readOnly}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <CapabilitiesProvider>
          <SyncProviderRoot token={firmaConfig.token}>
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
          </CapabilitiesProvider>
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
  // `user.list` returnerar `{ users }` (router-formen) — plocka ut ARRAYEN.
  // (Tidigare skickades hela objektet → `OidcAuthProvider.find` kastade →
  // boot:en fastnade tyst på "AVA Laddar…" eftersom denna väg lämnar
  // trpcClient null, så fel-skärmen aldrig renderas.)
  const { users } = await a.client.user.list.query();
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
