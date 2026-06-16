/**
 * Tester för DatasourceSection (#27 coverage) — wrappern på /settings:
 * laddningstillstånd (config ej läst än) vs laddat (rubrik + barn-paneler).
 * Barn-komponenterna (FirmaSettingsPanel/FsaFolderSelector/SyncDiagnostics)
 * stubbas — de testas separat.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DatasourceSection } from "@/components/settings/datasource-section";

let loaded: unknown = { tier: "self-hosted", repo: "http://x/git/firma.git", token: "t" };
vi.mock("@/lib/client/firma/firma-config", () => ({ loadFirmaConfig: () => loaded }));
vi.mock("@/components/settings/firma-settings-panel", () => ({
  FirmaSettingsPanel: ({ children }: { children?: React.ReactNode }) => <div data-testid="firma-panel">{children}</div>,
}));
vi.mock("@/components/settings/fsa-folder-selector", () => ({
  FsaFolderSelector: () => <div data-testid="fsa-selector" />,
}));
vi.mock("@/components/settings/sync-diagnostics", () => ({
  SyncDiagnostics: () => <div data-testid="sync-diagnostics" />,
}));

beforeEach(() => {
  vi.clearAllMocks();
  loaded = { tier: "self-hosted", repo: "http://x/git/firma.git", token: "t" };
});

describe("DatasourceSection", () => {
  it("laddat: visar rubrik + firma-panel med FSA-väljare + sync-status", async () => {
    render(<DatasourceSection />);
    await waitFor(() => expect(screen.getByText("Datakälla & inloggning")).toBeInTheDocument());
    expect(screen.getByTestId("firma-panel")).toBeInTheDocument();
    expect(screen.getByTestId("fsa-selector")).toBeInTheDocument();
    expect(screen.getByTestId("sync-diagnostics")).toBeInTheDocument();
  });

  it("laddningstillstånd när config ännu inte lästs (null)", () => {
    loaded = null;
    render(<DatasourceSection />);
    expect(screen.getByText(/Laddar datakälla/i)).toBeInTheDocument();
    expect(screen.queryByTestId("firma-panel")).not.toBeInTheDocument();
  });
});
