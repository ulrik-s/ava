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

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import superjson from "superjson";
import { AnalyzeDispatcherRegistrar } from "@/components/documents/analyze-dispatcher-registrar";
import { ExtractTextDispatcherRegistrar } from "@/components/documents/extract-text-dispatcher-registrar";
import { MirrorOutlookRegistrar } from "@/components/matter/mirror-outlook-registrar";
import { HelperAutoConfig } from "@/components/shell/helper-auto-config";
import { RenderErrorBoundary } from "@/components/ui/render-error-boundary";
import { decideSessionGate, loginUrl, offlineGateMessage, type CachedIdentity } from "@/lib/client/auth/session-gate";
import { setSessionNotice } from "@/lib/client/auth/session-notice";
import type { SessionProbe } from "@/lib/client/auth/session-probe";
import { AuthProvider, useAuthMode } from "@/lib/client/auth/use-auth-mode";
import { createDemoStore } from "@/lib/client/backend/create-demo-store";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import { inProcessPorts } from "@/lib/client/backend/in-process-ports";
import type { LocalDataPlace } from "@/lib/client/backend/local-data/local-data-locations";
import { openLocalDataSession, type IdentityConfig } from "@/lib/client/backend/local-data/local-data-session";
import { bindLocalNamespace, SHARED_NAMESPACE } from "@/lib/client/backend/local-data/local-namespace";
import { onSignedOutElsewhere } from "@/lib/client/backend/local-data/session-channel";
import { pendingSignOutRedirect } from "@/lib/client/backend/local-data/sign-out";
import type { OidcLoginOutcome, OidcClaims } from "@/lib/client/backend/oidc-principal";
import { loadServerHelperConfig } from "@/lib/client/backend/server-trpc-client";
import { CapabilitiesProvider } from "@/lib/client/capabilities/use-capabilities";
import { demoDataBaseUrl } from "@/lib/client/demo/demo-data-base";
import { DemoModeProvider } from "@/lib/client/demo/demo-mode-context";
import type { ProcedureRecorder } from "@/lib/client/demo/in-process-link";
import { loadFirmaConfig, patchFirmaConfig, type FirmaConfig } from "@/lib/client/firma/firma-config";
import { makeAppQueryClient } from "@/lib/client/query-client";
import { SyncProviderRoot } from "@/lib/client/sync/sync-context";
import { trpc } from "@/lib/client/trpc";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import type { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { asId } from "@/lib/shared/schemas/ids";
import { ActiveMatterPrefetch } from "./active-matter-prefetch";
import { AppShell } from "./app-shell";
import { AuthStatusBanner } from "./auth-status-banner";
import { AutoSync } from "./auto-sync";
import { LoadingScreen, PendingBootScreen, type BootStatus } from "./boot-screen";
import { JobsBadge } from "./jobs-badge";
import { ReauthBanner } from "./reauth-banner";
import { ServerFirstSync } from "./server-first-sync";
import { ServerInvoiceNumbering } from "./server-invoice-numbering";
import { UnsavedWritesGuard } from "./unsaved-writes-guard";
import "@/lib/client/jobs/register-workers"; // ⚠ side-effect: registrerar workers

type Status = BootStatus;

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

function createDemoTrpcClient(dataStore: IDataStore, firmaConfig: FirmaConfig, recordProcedure?: ProcedureRecorder) {
  const ports = inProcessPorts(dataStore, firmaConfig);

  return trpc.createClient({
    links: [
      new GitBackendRuntime({
        dataStore,
        ports,
        ...(recordProcedure ? { recordProcedure } : {}),
        authProvider: new GitAuthProvider({
          // principalId sätts av login-flowet (`/login`). Demo utan satt
          // principal → guest-id (datakällan filtrerar bort user-bundna
          // queries tills login gjorts). Self-hosted-seed:en använder
          // "current-user" tills self-hosted-login är implementerad.
          id: asId<"UserId">(firmaConfig.principalId
            || (firmaConfig.tier === "self-hosted" ? "current-user" : "")),
          email: firmaConfig.authorEmail,
          name: firmaConfig.authorName,
          role: "ADMIN",
          organizationId: asId<"OrganizationId">(firmaConfig.organizationId),
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
    const baseUrl = demoDataBaseUrl(firmaConfig.repo);
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
      // En annan flik loggade ut (#1347): ladda om, i stället för att arbeta vidare i den utloggades databaser.
      const offSignedOut = onSignedOutElsewhere();
      return () => { cancelled = true; offSignedOut(); };
    }

    // ── demo/github-tier: persisterad offline-first-kärna utan synk-mål ──
    // `createDemoStore` hydrerar IndexedDB-cachen om den finns, annars laddas
    // den bundlade `demo-seed.json` in via reconcile/pull (ADR 0025). Demons
    // påhittade data delas medvetet av demoanvändarna (#1347: gemensamma namn).
    bindLocalNamespace(SHARED_NAMESPACE);
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
  const [cachingSync, setCachingSync] = useState<CachingSyncDataStore | null>(null);
  // Initial status MÅSTE vara SSR-stabil för att undvika hydration-mismatch
  // (React #418). Pathname-baserad logik flyttas till useDemoBootstrap.
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queryClient] = useState(makeAppQueryClient);
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
  if (!mounted) return <LoadingScreen />;

  // Skip-auth-sidor (/login, /demo) bygger ALDRIG en demo-store/trpc-klient
  // (skip-ready-gaten i useDemoBootstrap returnerar tidigt). De renderar sitt
  // eget innehåll utan datakällan → gate:a INTE på trpcClient, annars fastnar
  // de för evigt på "AVA Laddar…" (regression från #498:s !trpcClient-gate; en
  // ny besökare utan principalId dirigeras till /login och kunde inte logga in).
  if (pathSkipsAuth(window.location.pathname)) {
    return <>{children}</>;
  }

  // Data-sidor väntar på att storen byggts. Ett fel innan dess (eller en
  // uppstart som aldrig blir klar) visas här — appträdets felskärm kräver
  // tRPC-klienten (#1391).
  if (!trpcClient) return <PendingBootScreen status={status} errorMsg={errorMsg} />;

  return (
    <AuthProvider token={firmaConfig.token} repoUrl={firmaConfig.repo}>
      <AuthGatedDemoTree
        firmaConfig={firmaConfig}
        trpcClient={trpcClient}
        queryClient={queryClient}
        status={status}
        errorMsg={errorMsg}
        cachingSync={cachingSync}
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
  /** Server-first-storen — synkas till servern efter varje ändring. Null i demon. */
  cachingSync: CachingSyncDataStore | null;
  children: ReactNode;
}

/** Server-synkens delar i statusraden — bara när det finns en server (ej demon). */
function ServerSyncParts({ store }: { store: CachingSyncDataStore | null }) {
  return (
    <>
      <ServerFirstSync store={store} />
      <ServerInvoiceNumbering store={store} />
      <ActiveMatterPrefetch store={store} />
    </>
  );
}

function AuthGatedDemoTree(props: TreeProps) {
  const { firmaConfig, trpcClient, queryClient, status, errorMsg, cachingSync, children } = props;
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
          {/* Serverns config hämtas från servern, inte in-process (#1161). Demon har ingen server. */}
          {!isDemoTier && <HelperAutoConfig loadConfig={loadServerHelperConfig} />}
          {/* Statusraden + appen delar på skärmhöjden — annars skjuts den
              fullhöjds-appen ned och hela sidan scrollar (#1185). */}
          <div className="flex h-full flex-col">
          {!isDemoTier && <ReauthBanner />}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white">
            <div className="flex-1 min-w-0">
              <AuthStatusBanner />
            </div>
            <div className="px-3 py-1.5 shrink-0 flex items-center gap-2">
              <JobsBadge />
              <AutoSync />
              <UnsavedWritesGuard store={cachingSync} />
              {!isDemoTier && <ServerSyncParts store={cachingSync} />}
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
          <div className="min-h-0 flex-1">
            <RenderErrorBoundary>
              <AppShell>{children}</AppShell>
            </RenderErrorBoundary>
          </div>
          </div>
          </SyncProviderRoot>
          </CapabilitiesProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </DemoModeProvider>
  );
}

/** Det sessionsgrinden behöver ur webbläsaren (injicerbart i tester). */
export interface GateEnv {
  now: () => number;
  redirect: (url: string) => void;
  location: () => { pathname: string; search: string };
}

const browserGateEnv: GateEnv = {
  now: () => Date.now(),
  redirect: (url) => { window.location.assign(url); },
  location: () => window.location,
};

type GateOutcome = { kind: "continue"; needsOidc: boolean; oidcClaims: OidcClaims | null } | { kind: "halt" };

/** Identiteten klienten senast arbetade under, eller null om ingen är bunden. */
function cachedIdentity(cfg: FirmaConfig): CachedIdentity | null {
  return cfg.principalId ? { principalId: cfg.principalId, email: cfg.authorEmail, verifiedAt: cfg.sessionVerifiedAt } : null;
}

/**
 * Sessionsgrinden (#1245, ADR 0018): varje self-hosted-start frågar
 * oauth2-proxy om sessionen (`probe`, frågad en gång av anroparen) — skalet
 * laddas numera utan inloggning.
 * `bind` = första inloggningen (eller en annan identitet): principalen binds
 * efter klon. `halt` = anroparen avbryter (omdirigerad till inloggningen,
 * eller offline utan giltig grace). `proceed-locally` (#1351) = inom grace
 * men utan bekräftad session: arbeta lokalt med "Logga in igen"-bannern.
 */
function runSessionGate(
  firmaConfig: FirmaConfig, probe: SessionProbe, env: GateEnv,
  setStatus: (s: Status) => void, setErrorMsg: (m: string | null) => void,
): GateOutcome {
  const decision = decideSessionGate(probe, cachedIdentity(firmaConfig), env.now());
  switch (decision.kind) {
    case "bind": return { kind: "continue", needsOidc: true, oidcClaims: decision.claims };
    case "proceed":
      if (decision.verifiedNow) patchFirmaConfig({ sessionVerifiedAt: env.now() });
      return { kind: "continue", needsOidc: false, oidcClaims: null };
    case "proceed-locally":
      setSessionNotice(decision.notice);
      return { kind: "continue", needsOidc: false, oidcClaims: null };
    case "login":
      env.redirect(loginUrl(env.location()));
      return { kind: "halt" };
    default:
      setStatus("error");
      setErrorMsg(offlineGateMessage(decision));
      return { kind: "halt" };
  }
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
    setErrorMsg(`Inte behörig: ditt konto (${outcome.email}) finns inte i byrån — kontakta administratören.`);
    return true;
  }
  if (outcome.kind === "authorized") {
    // Bind principalen och ladda om med rätt identitet. Sessionen är just
    // verifierad online → offline-grace:n räknas härifrån (#1245).
    patchFirmaConfig({
      principalId: outcome.principal.id,
      authorEmail: outcome.principal.email,
      authorName: outcome.principal.name,
      sessionVerifiedAt: Date.now(),
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
  makeStore?: (local: LocalDataPlace | "binding") => Promise<CachingSyncDataStore>;
  /** Webbläsaren för sessionsgrinden (#1245). */
  gateEnv?: GateEnv;
  makeClient?: (store: CachingSyncDataStore) => SelfHostedClient;
  /** Förbered den inloggades lokala databaser (#1347); `null` = bindningsfasen. */
  openLocal?: (cfg: IdentityConfig, args: { binding: boolean }) => Promise<LocalDataPlace | null>;
  /** Proxyns utloggning, om en utloggning inte hann avsluta den (#1347) — avgjort av proxyns svar (#1418). */
  pendingSignOut?: (probe: SessionProbe["kind"]) => string | null;
}

/** Webbläsarens lokala databaser (#1347). */
function browserOpenLocal(cfg: IdentityConfig, args: { binding: boolean }): Promise<LocalDataPlace | null> {
  return openLocalDataSession({ factory: globalThis.indexedDB, storage: window.localStorage }, cfg, args);
}

function browserPendingSignOut(probe: SessionProbe["kind"]): string | null {
  return pendingSignOutRedirect(window.localStorage, process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "", probe);
}

/**
 * Self-hosted server-first-bootstrap (ADR 0016, cutover #420–#422): bygg
 * `createServerFirstStore` + dess in-process tRPC-klient, bevara OIDC-first-
 * login-bindningen (allowlisten läses ur den reconcile:ade storen), och
 * signalera redo. Ersätter den gamla iso-git-OPFS-clonen. Exporterad +
 * dep-injicerbar för enhetstest (bootstrap-effekten är annars effekt-tung).
 */
async function defaultServerFirstStore(local: LocalDataPlace | "binding"): Promise<CachingSyncDataStore> {
  const { createServerFirstStore } = await import("@/lib/client/backend/server-first-store");
  return createServerFirstStore({ local });
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

/**
 * Storen i den inloggades lokala databaser (#1347). Ny/annan identitet →
 * bindningsfasen: storen ligger i minnet tills principalen är bunden (sidan
 * laddas då om).
 */
async function openSelfHostedStore(a: SelfHostedBootstrapArgs, binding: boolean): Promise<CachingSyncDataStore> {
  const place = await (a.openLocal ?? browserOpenLocal)(a.firmaConfig, { binding });
  return (a.makeStore ?? defaultServerFirstStore)(place ?? "binding");
}

/** Efter grinden: bygg store + klient, bind ev. principal, signalera redo. */
async function loadSelfHosted(a: SelfHostedBootstrapArgs, oidc: { needsOidc: boolean; oidcClaims: OidcClaims | null }): Promise<void> {
  const { firmaConfig, queryClient, setStatus, setErrorMsg, onStoreReady, isCancelled } = a;
  // Procedur-kön (#1265, ADR 0037): servern kör om köbara anrop auktoritativt.
  const makeClient = a.makeClient ?? ((store: CachingSyncDataStore) =>
    createDemoTrpcClient(store.store, firmaConfig, (call, exec) => store.runQueuedProcedure(call, exec)));
  const store = await openSelfHostedStore(a, oidc.needsOidc);
  if (isCancelled()) return;
  const client = makeClient(store);
  if (await bindOidcFirstLogin({ ...oidc, client, setStatus, setErrorMsg })) return;
  if (isCancelled()) return;
  onStoreReady(store, client);
  await queryClient.invalidateQueries();
  setStatus("ready");
  // Signalera redo → SyncProviderRoot plockar om sync-provider:n.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ava:repo-ready"));
}

export async function bootstrapSelfHosted(a: SelfHostedBootstrapArgs): Promise<void> {
  try {
    const env = a.gateEnv ?? browserGateEnv;
    const { probeSession } = await import("@/lib/client/auth/session-probe");
    const probe = await probeSession();
    // En utloggning som inte avslutade proxyns session (#1347): dit innan
    // grinden kan binda om den. Lever ingen session gör grinden som vanligt (#1418).
    const signOut = (a.pendingSignOut ?? browserPendingSignOut)(probe.kind);
    if (signOut) { env.redirect(signOut); return; }
    const gate = runSessionGate(a.firmaConfig, probe, env, a.setStatus, a.setErrorMsg);
    if (gate.kind === "halt") return;
    await loadSelfHosted(a, gate);
  } catch (err) {
    reportLoadError(err, a.isCancelled, a.setStatus, a.setErrorMsg);
  }
}
