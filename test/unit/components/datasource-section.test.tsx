/**
 * Tester för DatasourceSection (#27/#514 coverage) — wrappern på /settings:
 * laddningstillstånd (config ej läst än) vs laddat (rubrik + barn-paneler).
 * Barn-komponenterna (FirmaSettingsPanel/LoginStatus/SyncDiagnostics) stubbas
 * delvis — de testas separat. Inloggningen svarar ur en fejkad tRPC-länk.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DatasourceSection } from "@/components/settings/datasource-section";
import { fakeTrpcLink, TrpcTestProvider } from "../../helpers/trpc-fake";

let loaded: unknown = { tier: "self-hosted", repo: "http://x/git/firma.git", token: "t" };
vi.mock("@/lib/client/firma/firma-config", () => ({ loadFirmaConfig: () => loaded }));
vi.mock("@/components/settings/firma-settings-panel", () => ({
  FirmaSettingsPanel: ({ children }: { children?: React.ReactNode }) => <div data-testid="firma-panel">{children}</div>,
}));
vi.mock("@/components/settings/sync-diagnostics", () => ({
  SyncDiagnostics: () => <div data-testid="sync-diagnostics" />,
}));
const requestSignOut = vi.fn();
vi.mock("@/components/shell/sign-out-flow", () => ({
  useSignOutFlow: () => ({ requestSignOut, busy: false, dialog: <div data-testid="sign-out-dialog" /> }),
}));

/** Renderar sektionen under en fejkad tRPC-länk: inloggad som Anna. */
function renderSection() {
  const fake = fakeTrpcLink({ "user.current": () => ({ name: "Anna", email: "anna@firma.se" }) });
  return render(<TrpcTestProvider link={fake.link}><DatasourceSection /></TrpcTestProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  loaded = { tier: "self-hosted", repo: "http://x/git/firma.git", token: "t" };
});

describe("DatasourceSection", () => {
  it("laddat: visar rubrik + firma-panel med inloggningsstatus + sync-status", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText("Datakälla & inloggning")).toBeInTheDocument());
    expect(screen.getByTestId("firma-panel")).toBeInTheDocument();
    expect(screen.getByText(/Inloggad som/)).toBeInTheDocument();
    expect(await screen.findByText("Anna")).toBeInTheDocument();
    expect(screen.getByTestId("sync-diagnostics")).toBeInTheDocument();
  });

  it("Logga ut startar utloggningsflödet (#1347) och dess dialog renderas", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Logga ut" }));
    expect(requestSignOut).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sign-out-dialog")).toBeInTheDocument();
  });

  it("laddningstillstånd när config ännu inte lästs (null)", () => {
    loaded = null;
    renderSection();
    expect(screen.getByText(/Laddar datakälla/i)).toBeInTheDocument();
    expect(screen.queryByTestId("firma-panel")).not.toBeInTheDocument();
  });
});
