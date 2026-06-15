"use client";

/**
 * `DemoBootstrap` — singleton-init av DemoRuntime + DemoDataStore i
 * demo-builden. Tillåter alla sidor att köra tRPC mot demo-data.
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
import { demoCacheKey } from "@/lib/client/demo/demo-cache-key";
import { DemoModeProvider } from "@/lib/client/demo/demo-mode-context";
import { demoSourceFromRuntime } from "@/lib/client/demo/demo-source-from-runtime";
import { loadFirmaConfig, patchFirmaConfig, gitAuthUsername, type FirmaConfig } from "@/lib/client/firma/firma-config";
import { pickProvider } from "@/lib/client/sync/pick-provider";
import { SyncProviderRoot } from "@/lib/client/sync/sync-context";
import { trpc } from "@/lib/client/trpc";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";
import { DemoRuntime } from "@/lib/server/local-first/demo-runtime";
import { createGhPagesCloneFn } from "@/lib/server/local-first/gh-pages-loader";
import { OpfsPersistence } from "@/lib/server/local-first/persistence";
import { omitUndefined } from "@/lib/shared/omit-undefined";
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
 * m.fl.) från slaben efter en reload, så `openDocument`/`openGeneratedDoc`
 * (blob:-URL) fungerar igen. Slabens `documents/content/` innehåller ENBART
 * runtime-genererat innehåll — seed-dokumentens content ligger inte i manifestet
 * (hämtas on-demand från GH Pages), så ingen krock.
 */
interface DocMeta { id: string; fileName?: string; storagePath?: string; mimeType?: string }
type StashFn = (id: string, bytes: Uint8Array, mimeType: string, fileName: string) => void;

/** base64 → bytes (för event-transport av binärt dokument-innehåll). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function inferDocMime(file: string, meta: DocMeta | undefined): string {
  if (meta?.mimeType) return meta.mimeType;
  if (file.endsWith(".pdf")) return "application/pdf";
  return file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
}

async function stashSlabDoc(runtime: DemoRuntime, file: string, docs: readonly DocMeta[], stash: StashFn): Promise<void> {
  const meta = docs.find((d) => d.storagePath === `documents/content/${file}`);
  const bytes = await runtime.readFileBytes(`documents/content/${file}`).catch(() => null);
  if (bytes == null) return; // trasig/oläsbar fil → hoppa över
  const id = meta?.id ?? file.replace(/\.[^.]+$/, "");
  stash(id, bytes, inferDocMime(file, meta), meta?.fileName ?? file);
}

async function rehydrateGeneratedDocs(runtime: DemoRuntime, source: DemoSource): Promise<void> {
  let files: string[];
  try { files = await runtime.listFiles("documents/content"); } catch { return; }
  if (!files.length) return;
  const { stashGeneratedDoc } = await import("@/lib/client/demo/generated-doc-cache");
  const docs = (source.documents ?? []) as unknown as readonly DocMeta[];
  for (const f of files) await stashSlabDoc(runtime, f, docs, stashGeneratedDoc);
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
 * Lyssnar på text-extraktions- och generated-doc-event från job-workers och
 * skriver via writeBack-pipelinen / demo-slaben (överlever reload, kan öppnas
 * via blob:-URL). Self-hosted utan demo-runtime → generated-doc är no-op.
 */
function useWriteBackListeners(
  writeBack: (event: WriteBackEvent) => Promise<void>,
  runtimeRef: { current: DemoRuntime | null },
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; storagePath: string; contentBase64: string }>).detail;
      const rt = runtimeRef.current;
      if (!detail || !rt) return;
      void (async () => {
        try {
          await rt.writeFileBytes(detail.storagePath, base64ToBytes(detail.contentBase64));
          await rt.persist();
        } catch (err) {
          console.warn("[demo] generated-doc persist failed:", err);
        }
      })();
    };
    window.addEventListener("ava:generated-doc", handler);
    return () => window.removeEventListener("ava:generated-doc", handler);
  }, [runtimeRef]);
}

function makeDemoQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
      mutations: { retry: false },
    },
  });
}

function createDemoTrpcClient(dataStore: DemoDataStore, firmaConfig: FirmaConfig) {
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
}

/**
 * Mount-only bootstrap: gate-check → self-hosted-clone, eller demo-slab-
 * restore/fresh-clone + FSA-handle-laddning. Fyller refs och sätter status.
 */
function useDemoBootstrap(args: BootstrapArgs) {
  const { firmaConfig, source, queryClient, fsaRef, runtimeRef, setFsaHandle, setStatus, setErrorMsg } = args;
  useEffect(() => {
    const gate = checkBootstrapGate(firmaConfig);
    if (gate === "skip-ready") { queueMicrotask(() => setStatus("ready")); return; }
    if (gate === "redirect-login") return; // sidan reloadar — släng inget annat
    if (gate === "skip-loading") return;

    let cancelled = false;

    // ── Self-hosted-tier: klona repo:t in i OPFS + hydrera därifrån ──
    // (egen git-server, t.ex. docker:8080/git eller firma-Linux-låda).
    // OPFS kräver ingen mapp-dialog → fungerar headless (e2e) + iOS.
    if (firmaConfig.tier === "self-hosted") {
      void loadSelfHosted({ firmaConfig, source, queryClient, fsaRef, setFsaHandle, setStatus, setErrorMsg, isCancelled: () => cancelled });
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
      persistence: new OpfsPersistence(demoCacheKey()),
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
          void rehydrateGeneratedDocs(runtime, source);
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
  useWriteBackListeners(writeBack, runtimeRef);

  const [dataStore] = useState(() => new DemoDataStore(source, writeBack));
  // Initial status MÅSTE vara SSR-stabil för att undvika hydration-mismatch
  // (React #418). Pathname-baserad logik flyttas till useDemoBootstrap.
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queryClient] = useState(makeDemoQueryClient);
  const [trpcClient] = useState(() => createDemoTrpcClient(dataStore, firmaConfig));

  // Flippa efter första commit → byter från platshållare till full app-tree.
  // Egen effekt (separat från boot-effekten) så hydreringen hinner committa rent.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- engångs-flip; det ÄR avsikten
  useEffect(() => { setMounted(true); }, []);

  useDemoBootstrap({ firmaConfig, source, queryClient, fsaRef, runtimeRef, setFsaHandle, setStatus, setErrorMsg });

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

  // readOnly avgörs av auth-mode. FSA-handle krävs fortfarande för att
  // write faktiskt ska landa på disk; om vi saknar handle visar vi UI:n
  // som write-mode men sync-pillen kommer berätta att inget skrivs.
  //
  // I demo-tier ger vi däremot full write-känsla i UI:n — mutationer
  // landar i DemoDataStore (in-memory), de bara persister inte över
  // page reload. DemoModeBanner förklarar för användaren.
  const isDemoTier = firmaConfig.tier === "demo";
  const readOnly = isDemoTier ? false : (auth.mode !== "identified-write" || fsaHandle === null);

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
interface LoadSelfHostedArgs {
  firmaConfig: FirmaConfig;
  source: DemoSource;
  queryClient: QueryClient;
  fsaRef: { current: FileSystemDirectoryHandle | null };
  setFsaHandle: (h: FileSystemDirectoryHandle | null) => void;
  setStatus: (s: Status) => void;
  setErrorMsg: (m: string | null) => void;
  isCancelled: () => boolean;
}

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async function 'loadSelfHosted' has a complexity of 9. Maximum allowed is 8.)
async function loadSelfHosted(args: LoadSelfHostedArgs): Promise<void> {
  const { firmaConfig, source, queryClient, fsaRef, setFsaHandle, setStatus, setErrorMsg, isCancelled } = args;
  try {
    const { getOpfsRoot, saveHandle } = await import("@/lib/client/fsa/handle-store");
    const { loadSelfHostedSource } = await import("@/lib/client/firma/load-self-hosted-source");
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

    // OIDC-login (#222/#223): på första self-hosted-laddningen (ingen principal
    // bunden än) — om vi ligger bakom oauth2-proxy svarar /oauth2/userinfo med
    // den inloggades email. Då klonar vi UTAN syntetisk currentUser (skriver
    // ingen "current-user"-rad), löser principalen mot allowlisten och reloadar
    // med bunden principalId. Utan OIDC-session: oförändrat current-user-flöde.
    const { fetchOidcClaims, classifyOidcLogin } = await import("@/lib/client/backend/oidc-principal");
    const needsOidc = firmaConfig.tier === "self-hosted" && !firmaConfig.principalId;
    const oidcClaims = needsOidc ? await fetchOidcClaims().catch(() => null) : null;

    const currentUser = needsOidc && oidcClaims
      ? undefined
      : {
          // Måste matcha trpcClient-användaren (id principalId ?? "current-user")
          // så att flöden som slår upp ctx.user (timeEntry.create m.fl.) hittar en rad.
          id: firmaConfig.principalId ?? "current-user",
          email: firmaConfig.authorEmail,
          name: firmaConfig.authorName,
          organizationId: firmaConfig.organizationId,
        };
    const src = await loadSelfHostedSource({
      handle: opfs,
      repo: firmaConfig.repo,
      token: firmaConfig.token,
      username: gitAuthUsername(firmaConfig),
      ...omitUndefined({ origin, currentUser }),
    });
    if (isCancelled()) return;

    if (needsOidc && oidcClaims) {
      const outcome = classifyOidcLogin(oidcClaims, (src.users ?? []) as never);
      if (outcome.kind === "denied") {
        setStatus("error");
        setErrorMsg(`Inte behörig: ${outcome.email} finns inte i byråns användarlista.`);
        return;
      }
      if (outcome.kind === "authorized") {
        // Bind principalen och ladda om med rätt identitet.
        patchFirmaConfig({
          principalId: outcome.principal.id,
          authorEmail: outcome.principal.email,
          authorName: outcome.principal.name,
        });
        if (typeof window !== "undefined") window.location.reload();
        return;
      }
    }

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
