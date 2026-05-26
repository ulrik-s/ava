/**
 * Tester för `SyncDiagnostics`-panelen i /settings.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SyncDiagnostics } from "@/components/settings/sync-diagnostics";
import type { SyncState } from "@/lib/client/sync/use-auto-sync";

const ctxState = {
  state: { kind: "idle" } as SyncState,
  syncNow: vi.fn(async () => {}),
  notifyChange: vi.fn(),
  providerKind: "fsa" as "fsa" | null,
  lastError: null as string | null,
};

vi.mock("@/lib/client/sync/sync-context", () => ({
  useSyncContext: () => ctxState,
}));

function reset(): void {
  ctxState.state = { kind: "idle" } as SyncState;
  ctxState.providerKind = "fsa";
  ctxState.lastError = null;
  ctxState.syncNow.mockClear();
}

describe("SyncDiagnostics", () => {
  it("visar 'ingen lokal mapp vald' när ingen provider", () => {
    reset();
    ctxState.providerKind = null;
    render(<SyncDiagnostics />);
    expect(screen.getByText(/ingen lokal mapp vald/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Synka nu/ })).not.toBeInTheDocument();
  });

  it("visar 'Synkstatus' + 'Synka nu'-knapp när provider finns", () => {
    reset();
    render(<SyncDiagnostics />);
    expect(screen.getByRole("heading", { name: /Synkstatus/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Synka nu/ })).toBeInTheDocument();
  });

  it("visar StateLabel för synced med tidsstämpel", () => {
    reset();
    ctxState.state = { kind: "synced", at: Date.now() } as SyncState;
    render(<SyncDiagnostics />);
    expect(screen.getByText(/Allt sparat/)).toBeInTheDocument();
  });

  it("visar StateLabel för syncing pull", () => {
    reset();
    ctxState.state = { kind: "syncing", what: "pull" } as SyncState;
    render(<SyncDiagnostics />);
    expect(screen.getByText(/Hämtar uppdateringar/)).toBeInTheDocument();
  });

  it("disable:ar 'Synka nu' medan syncing pågår", () => {
    reset();
    ctxState.state = { kind: "syncing", what: "push" } as SyncState;
    render(<SyncDiagnostics />);
    expect(screen.getByRole("button", { name: /Synka nu/ })).toBeDisabled();
  });

  it("klick på 'Synka nu' triggar syncNow()", () => {
    reset();
    render(<SyncDiagnostics />);
    fireEvent.click(screen.getByRole("button", { name: /Synka nu/ }));
    expect(ctxState.syncNow).toHaveBeenCalled();
  });

  it("visar senaste fel + tips när lastError finns", () => {
    reset();
    ctxState.lastError = "Pull: token avvisades (401)";
    render(<SyncDiagnostics />);
    expect(screen.getByText(/Senaste fel/i)).toBeInTheDocument();
    expect(screen.getByText(/token avvisades/i)).toBeInTheDocument();
    expect(screen.getByText(/Vanliga orsaker/i)).toBeInTheDocument();
  });

  it("visar Web FSA-miljö-label", () => {
    reset();
    ctxState.providerKind = "fsa";
    render(<SyncDiagnostics />);
    expect(screen.getByText(/Web FSA/)).toBeInTheDocument();
  });
});
