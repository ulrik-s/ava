/**
 * Tester för IntegrationsSection (#27 coverage) — generisk connector-lista:
 * tomtillstånd, status-rader (alla StatusLine-grenar), samt connect/disconnect
 * med busy- och fel-hantering.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { IntegrationsSection } from "@/components/settings/integrations-section";
import type { ConnectionStatus } from "@/lib/client/integrations/types";

let connectors: unknown[] = [];
let currentStatus: ConnectionStatus = { kind: "disconnected" };
const connectFn = vi.fn(async () => {});
const disconnectFn = vi.fn(async () => {});

function fakeConnector() {
  return {
    id: "ms365",
    displayName: "Microsoft 365",
    capabilities: ["mail", "calendar"],
    subscribe: (cb: (s: ConnectionStatus) => void) => { cb(currentStatus); return () => {}; },
    connect: connectFn,
    disconnect: disconnectFn,
  };
}

vi.mock("@/lib/client/integrations/office365-connector", () => ({}));
vi.mock("@/lib/client/integrations/registry", () => ({ listConnectors: () => connectors }));

beforeEach(() => {
  vi.clearAllMocks();
  connectors = [fakeConnector()];
  currentStatus = { kind: "disconnected" };
});

describe("IntegrationsSection", () => {
  it("renderar null när inga connectors finns", () => {
    connectors = [];
    const { container } = render(<IntegrationsSection />);
    expect(container.firstChild).toBeNull();
  });

  it("visar connector med namn + capabilities + 'Ej ansluten'", () => {
    render(<IntegrationsSection />);
    expect(screen.getByText("Microsoft 365")).toBeInTheDocument();
    expect(screen.getByText("mail · calendar")).toBeInTheDocument();
    expect(screen.getByText("Ej ansluten")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anslut" })).toBeInTheDocument();
  });

  it("connected-status → visar e-post + 'Koppla bort'", () => {
    currentStatus = { kind: "connected", account: { email: "anna@firma.se" } } as ConnectionStatus;
    render(<IntegrationsSection />);
    expect(screen.getByText(/anna@firma\.se/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Koppla bort" })).toBeInTheDocument();
  });

  it("expired + error-status renderar respektive StatusLine-gren", () => {
    currentStatus = { kind: "expired" } as ConnectionStatus;
    const { unmount } = render(<IntegrationsSection />);
    expect(screen.getByText(/Token förfallit/)).toBeInTheDocument();
    unmount();
    currentStatus = { kind: "error", message: "boom" } as ConnectionStatus;
    render(<IntegrationsSection />);
    expect(screen.getByText(/✗ boom/)).toBeInTheDocument();
  });

  it("Anslut anropar connector.connect", async () => {
    render(<IntegrationsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Anslut" }));
    await waitFor(() => expect(connectFn).toHaveBeenCalled());
  });

  it("Koppla bort anropar connector.disconnect", async () => {
    currentStatus = { kind: "connected", account: { email: "a@b.se" } } as ConnectionStatus;
    render(<IntegrationsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Koppla bort" }));
    await waitFor(() => expect(disconnectFn).toHaveBeenCalled());
  });

  it("fel vid connect visas i raden", async () => {
    connectFn.mockRejectedValueOnce(new Error("nätverksfel"));
    render(<IntegrationsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Anslut" }));
    await waitFor(() => expect(screen.getByText("nätverksfel")).toBeInTheDocument());
  });
});
