/**
 * `DemoBootstrap` renderad (#1905): uppstarten väljer väg efter driftläget och
 * visar appen, felskärmen eller sidan utan inloggning. Storen, klienten och
 * skalets delar mockas; orkestreringen i komponenten är det som prövas.
 * Grindarna (`checkBootstrapGate`) och `bootstrapSelfHosted` har egna tester.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";

const passThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
const nothing = () => null;

/** Byråns config där appen läser den (localStorage `ava.firma`). */
function useConfig(cfg: FirmaConfig): void {
  localStorage.setItem("ava.firma", JSON.stringify(cfg));
}
const createDemoStore = vi.fn();
const resolveClientPrincipal = vi.fn(() => Promise.resolve({ id: "p1", email: "a@b.se", name: "A", role: "LAWYER", organizationId: "org" }));
const preloadDocumentContents = vi.fn((): Promise<void> => Promise.resolve());
const loadAllGeneratedDocBlobs = vi.fn((): Promise<Array<{ id: string; bytes: Uint8Array; mimeType: string; fileName: string }>> => Promise.resolve([]));
const stashGeneratedDoc = vi.fn();
const probeSession = vi.fn((): Promise<unknown> => Promise.resolve({ kind: "signed-out" }));
const offSignedOut = vi.fn();
// En tRPC-länk: createTRPCClient anropar den med runtime när klienten byggs.
const createLink = vi.fn(() => () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) }));
const authMode = { mode: "identified-write" };

vi.mock("@/lib/client/backend/create-demo-store", () => ({ createDemoStore: (...a: unknown[]) => createDemoStore(...a) }));
vi.mock("@/lib/client/backend/client-principal", () => ({
  resolveClientPrincipal: (...a: unknown[]) => resolveClientPrincipal(...(a as [])),
  bindClientOrganization: () => false,
}));
vi.mock("@/lib/client/backend/git-backend-runtime", () => ({
  GitBackendRuntime: class { createLink() { return createLink(); } },
}));
vi.mock("@/lib/client/backend/in-process-ports", () => ({ inProcessPorts: () => ({}) }));
vi.mock("@/lib/client/backend/local-data/session-channel", () => ({ onSignedOutElsewhere: () => offSignedOut }));
vi.mock("@/lib/client/auth/session-probe", () => ({ probeSession: (...a: unknown[]) => probeSession(...(a as [])) }));
const createServerFirstStore = vi.fn();
vi.mock("@/lib/client/backend/server-first-store", () => ({ createServerFirstStore: (...a: unknown[]) => createServerFirstStore(...a) }));
vi.mock("@/lib/client/demo/document-content-cache", () => ({ preloadDocumentContents: (...a: unknown[]) => preloadDocumentContents(...(a as [])) }));
vi.mock("@/lib/client/demo/generated-doc-idb", () => ({ loadAllGeneratedDocBlobs: () => loadAllGeneratedDocBlobs() }));
vi.mock("@/lib/client/demo/generated-doc-cache", () => ({ stashGeneratedDoc: (...a: unknown[]) => stashGeneratedDoc(...(a as [])) }));
vi.mock("@/components/shell/trpc-providers", () => ({ TrpcProviders: passThrough }));
vi.mock("@/lib/client/auth/use-auth-mode", () => ({ AuthProvider: passThrough, useAuthMode: () => authMode }));
vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ CapabilitiesProvider: passThrough }));
vi.mock("@/lib/client/sync/sync-context", () => ({ SyncProviderRoot: passThrough }));
vi.mock("@/lib/client/jobs/register-workers", () => ({}));
vi.mock("@/components/documents/analyze-dispatcher-registrar", () => ({ AnalyzeDispatcherRegistrar: nothing }));
vi.mock("@/components/documents/extract-text-dispatcher-registrar", () => ({ ExtractTextDispatcherRegistrar: nothing }));
vi.mock("@/components/shell/helper-auto-config", () => ({ HelperAutoConfig: () => <span>hjälpprogrammet</span> }));
vi.mock("@/components/shell/app-shell", () => ({ AppShell: ({ children }: { children?: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/shell/auth-status-banner", () => ({ AuthStatusBanner: nothing }));
vi.mock("@/components/shell/auto-sync", () => ({ AutoSync: nothing }));
vi.mock("@/components/shell/jobs-badge", () => ({ JobsBadge: nothing }));
vi.mock("@/components/shell/reauth-banner", () => ({ ReauthBanner: () => <span>logga in igen</span> }));
vi.mock("@/components/shell/session-keepalive", () => ({ SessionKeepalive: nothing }));
vi.mock("@/components/shell/unsaved-writes-guard", () => ({ UnsavedWritesGuard: nothing }));
vi.mock("@/components/shell/server-first-sync", () => ({ ServerFirstSync: () => <span>serversynken</span> }));
vi.mock("@/components/shell/server-invoice-numbering", () => ({ ServerInvoiceNumbering: nothing }));
vi.mock("@/components/shell/active-matter-prefetch", () => ({ ActiveMatterPrefetch: nothing }));

const demoConfig: FirmaConfig = {
  tier: "demo", repo: "u/r", token: "", organizationId: "org", principalId: "p1", authorName: "A", authorEmail: "a@b.se",
};

const demoStore = {
  store: { currentSource: { documents: [{ id: "d1", fileName: "a.md" }] } },
};

let restoreLocation: () => void = () => {};

function setLocation(pathname: string): { assign: ReturnType<typeof vi.fn> } {
  const original = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname, search: "", replace: vi.fn(), assign, reload: vi.fn() },
  });
  restoreLocation = () => Object.defineProperty(window, "location", { configurable: true, value: original });
  return { assign };
}

async function renderBootstrap(): Promise<ReturnType<typeof render>> {
  const { DemoBootstrap } = await import("@/components/shell/demo-bootstrap");
  return render(<DemoBootstrap><p>sidans innehåll</p></DemoBootstrap>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useConfig(demoConfig);
  authMode.mode = "identified-write";
  createDemoStore.mockResolvedValue(demoStore);
});

afterEach(() => {
  restoreLocation();
  restoreLocation = () => {};
});

describe("DemoBootstrap — demon", () => {
  it("bygger storen och klienten, visar appen och laddar dokumenten i bakgrunden", async () => {
    setLocation("/matters");
    loadAllGeneratedDocBlobs.mockResolvedValueOnce([{ id: "g1", bytes: new Uint8Array([1]), mimeType: "application/pdf", fileName: "k.pdf" }]);
    await renderBootstrap();
    await waitFor(() => expect(screen.getByText("sidans innehåll")).toBeInTheDocument());
    expect(createDemoStore).toHaveBeenCalledWith(expect.objectContaining({ tier: "demo", repo: "u/r", principalId: "p1" }));
    expect(createLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(stashGeneratedDoc).toHaveBeenCalledWith("g1", expect.any(Uint8Array), "application/pdf", "k.pdf"));
    expect(preloadDocumentContents).toHaveBeenCalledWith([{ id: "d1", fileName: "a.md" }], expect.any(String));
    // Demon har ingen server: varken serversynken eller hjälpprogrammets config.
    expect(screen.queryByText("serversynken")).toBeNull();
    expect(screen.queryByText("hjälpprogrammet")).toBeNull();
  });

  it("en dokumentförladdning som misslyckas varnar bara", async () => {
    setLocation("/matters");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    preloadDocumentContents.mockRejectedValueOnce(new Error("offline"));
    await renderBootstrap();
    await waitFor(() => expect(warn).toHaveBeenCalledWith("[demo] document-content preload failed:", expect.any(Error)));
    expect(screen.getByText("sidans innehåll")).toBeInTheDocument();
    warn.mockRestore();
  });

  it("en store som inte går att bygga visar felet i stället för appen", async () => {
    setLocation("/matters");
    createDemoStore.mockRejectedValueOnce(new Error("seed saknas"));
    await renderBootstrap();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("seed saknas"));
    expect(screen.queryByText("sidans innehåll")).toBeNull();
  });

  it("ett fel som inte är ett Error visas som text", async () => {
    setLocation("/matters");
    createDemoStore.mockRejectedValueOnce("trasig cache");
    await renderBootstrap();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("trasig cache"));
  });

  it("inloggningssidan visas direkt, utan store", async () => {
    setLocation("/login/");
    await renderBootstrap();
    await waitFor(() => expect(screen.getByText("sidans innehåll")).toBeInTheDocument());
    expect(createDemoStore).not.toHaveBeenCalled();
  });

  it("avmonterad innan storen är klar: ingen klient byggs", async () => {
    setLocation("/matters");
    let resolveStore: (s: unknown) => void = () => {};
    createDemoStore.mockImplementationOnce(() => new Promise((r) => { resolveStore = r; }));
    const { unmount } = await renderBootstrap();
    await waitFor(() => expect(createDemoStore).toHaveBeenCalled());
    unmount();
    resolveStore(demoStore);
    await new Promise((r) => setTimeout(r, 10));
    expect(resolveClientPrincipal).not.toHaveBeenCalled();
  });
});

describe("DemoBootstrap — självhostad", () => {
  const selfHosted: FirmaConfig = { ...demoConfig, tier: "self-hosted", repo: "https://firma.example/data.git" };

  it("utloggad: grinden skickar till inloggningen, och en annan fliks utloggning slutar lyssnas på vid avmontering", async () => {
    useConfig(selfHosted);
    const { assign } = setLocation("/matters");
    const { unmount } = await renderBootstrap();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining("/oauth2/start")));
    expect(createDemoStore).not.toHaveBeenCalled();
    unmount();
    expect(offSignedOut).toHaveBeenCalledTimes(1);
  });

  it("utan inloggningsproxy: den inloggades databaser, serversynken och hjälpprogrammet visas", async () => {
    useConfig(selfHosted);
    setLocation("/matters");
    probeSession.mockResolvedValueOnce({ kind: "absent" });
    const prevIdb = Reflect.get(globalThis, "indexedDB");
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const ready = vi.fn();
    window.addEventListener("ava:repo-ready", ready);
    createServerFirstStore.mockResolvedValueOnce({ store: { currentSource: {} }, runQueuedProcedure: vi.fn() });
    try {
      await renderBootstrap();
      await waitFor(() => expect(screen.getByText("sidans innehåll")).toBeInTheDocument());
      expect(createServerFirstStore).toHaveBeenCalledWith({ local: expect.objectContaining({ ns: expect.objectContaining({ kind: "user" }) }) });
      expect(screen.getByText("serversynken")).toBeInTheDocument();
      expect(screen.getByText("hjälpprogrammet")).toBeInTheDocument();
      expect(screen.getByText("logga in igen")).toBeInTheDocument();
      expect(ready).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("ava:repo-ready", ready);
      Reflect.set(globalThis, "indexedDB", prevIdb);
    }
  });
});
