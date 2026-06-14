/**
 * Tester för `SyncDiagnostics`-panelen i /settings.
 *
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { SyncDiagnostics, StateLabel } from "@/components/settings/sync-diagnostics";
import type { SyncState } from "@/lib/client/sync/use-auto-sync";

const ctxState = {
  state: { kind: "idle" } as SyncState,
  syncNow: vi.fn(async () => {}),
  notifyChange: vi.fn(),
  providerKind: "fsa" as "fsa" | null,
  lastError: null as string | null,
  enabled: true, // "Synka nu" är disabled när sync är inaktiv
};

vi.mock("@/lib/client/sync/sync-context", () => ({
  useSyncContext: () => ctxState,
}));

function reset(): void {
  ctxState.state = { kind: "idle" } as SyncState;
  ctxState.providerKind = "fsa";
  ctxState.lastError = null;
  ctxState.enabled = true;
  ctxState.syncNow.mockClear();
}

describe("SyncDiagnostics", () => {
  it("visar 'ingen lokal mapp vald' när ingen provider", () => {
    reset();
    ctxState.providerKind = null;
    render(<SyncDiagnostics />);
    expect(screen.getByText(/ingen mapp vald/i)).toBeInTheDocument();
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

describe("StateLabel (#6-ratchet: renderar-uppslag per läge)", () => {
  const cases: Array<[SyncState, RegExp]> = [
    [{ kind: "idle" }, /Väntar på första synk/],
    [{ kind: "synced", at: Date.now() }, /Allt sparat/],
    [{ kind: "syncing", what: "pull" }, /Hämtar uppdateringar/],
    [{ kind: "syncing", what: "push" }, /Sparar ändringar/],
    [{ kind: "pending", count: 1 }, /1 ändring —/],
    [{ kind: "pending", count: 3 }, /3 ändringar —/],
    [{ kind: "offline", count: 2 }, /Off-line — 2 ändringar/],
    [{ kind: "merge-needed" }, /Konflikt/],
    [{ kind: "error", message: "x" }, /misslyckades/],
  ];
  for (const [state, re] of cases) {
    it(`renderar "${state.kind}"`, () => {
      const { container } = render(<StateLabel state={state} />);
      expect(container.textContent ?? "").toMatch(re);
    });
  }
});
