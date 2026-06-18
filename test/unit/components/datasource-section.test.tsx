/**
 * Tester för DatasourceSection (#27/#514 coverage) — wrappern på /settings:
 * laddningstillstånd (config ej läst än) vs laddat (rubrik + barn-paneler).
 * Barn-komponenterna (FirmaSettingsPanel/LoginStatus/SyncDiagnostics) stubbas
 * delvis — de testas separat. LoginStatus använder trpc → stubbas här.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DatasourceSection } from "@/components/settings/datasource-section";

let loaded: unknown = { tier: "self-hosted", repo: "http://x/git/firma.git", token: "t" };
vi.mock("@/lib/client/firma/firma-config", () => ({ loadFirmaConfig: () => loaded }));
vi.mock("@/components/settings/firma-settings-panel", () => ({
  FirmaSettingsPanel: ({ children }: { children?: React.ReactNode }) => <div data-testid="firma-panel">{children}</div>,
}));
vi.mock("@/components/settings/sync-diagnostics", () => ({
  SyncDiagnostics: () => <div data-testid="sync-diagnostics" />,
}));
vi.mock("@/components/shell/sidebar", () => ({ signOutLocally: vi.fn() }));
const currentQuery = vi.fn(() => ({ isLoading: false, data: { name: "Anna", email: "anna@firma.se" } }));
vi.mock("@/lib/client/trpc", () => ({
  trpc: { user: { current: { useQuery: () => currentQuery() } } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  loaded = { tier: "self-hosted", repo: "http://x/git/firma.git", token: "t" };
});

describe("DatasourceSection", () => {
  it("laddat: visar rubrik + firma-panel med inloggningsstatus + sync-status", async () => {
    render(<DatasourceSection />);
    await waitFor(() => expect(screen.getByText("Datakälla & inloggning")).toBeInTheDocument());
    expect(screen.getByTestId("firma-panel")).toBeInTheDocument();
    expect(screen.getByText(/Inloggad som/)).toBeInTheDocument();
    expect(screen.getByText("Anna")).toBeInTheDocument();
    expect(screen.getByTestId("sync-diagnostics")).toBeInTheDocument();
  });

  it("laddningstillstånd när config ännu inte lästs (null)", () => {
    loaded = null;
    render(<DatasourceSection />);
    expect(screen.getByText(/Laddar datakälla/i)).toBeInTheDocument();
    expect(screen.queryByTestId("firma-panel")).not.toBeInTheDocument();
  });
});
