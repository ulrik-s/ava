/**
 * Tester för `SyncStatusPill` — renderar alla 7 sync-states.
 *
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { SyncStatusPill } from "@/components/shell/sync-status-pill";
import type { SyncState } from "@/lib/client/sync/use-auto-sync";

describe("SyncStatusPill", () => {
  it("idle: 'Inte synkat ännu'", () => {
    render(<SyncStatusPill state={{ kind: "idle" } as SyncState} />);
    expect(screen.getByText(/Inte synkat ännu/)).toBeInTheDocument();
  });

  it("synced: 'Sparat' + tooltip med relativ tid", () => {
    const now = Date.now();
    render(<SyncStatusPill state={{ kind: "synced", at: now } as SyncState} />);
    expect(screen.getByText(/Sparat/)).toBeInTheDocument();
    expect(screen.getByRole("link").getAttribute("title")).toMatch(/just nu|sedan/i);
  });

  it("syncing pull: 'Hämtar…'", () => {
    render(<SyncStatusPill state={{ kind: "syncing", what: "pull" } as SyncState} />);
    expect(screen.getByText(/Hämtar/)).toBeInTheDocument();
  });

  it("syncing push: 'Sparar…'", () => {
    render(<SyncStatusPill state={{ kind: "syncing", what: "push" } as SyncState} />);
    expect(screen.getByText(/Sparar/)).toBeInTheDocument();
  });

  it("pending: räknar singular vs plural", () => {
    const { rerender } = render(<SyncStatusPill state={{ kind: "pending", count: 1 } as SyncState} />);
    expect(screen.getByText(/1 ändring — sparas snart/)).toBeInTheDocument();
    rerender(<SyncStatusPill state={{ kind: "pending", count: 5 } as SyncState} />);
    expect(screen.getByText(/5 ändringar — sparas snart/)).toBeInTheDocument();
  });

  it("offline med ändringar: visar count", () => {
    render(<SyncStatusPill state={{ kind: "offline", count: 3 } as SyncState} />);
    expect(screen.getByText(/Off-line — 3 ändringar väntar/)).toBeInTheDocument();
  });

  it("offline utan ändringar: bara 'Off-line'", () => {
    render(<SyncStatusPill state={{ kind: "offline", count: 0 } as SyncState} />);
    expect(screen.getByText(/^Off-line$/)).toBeInTheDocument();
  });

  it("merge-needed: 'Merge behövs'", () => {
    render(<SyncStatusPill state={{ kind: "merge-needed" } as SyncState} />);
    expect(screen.getByText(/Merge behövs/)).toBeInTheDocument();
  });

  it("error: visar 'Synk-fel — försöker igen' + felmeddelande i tooltip", () => {
    render(<SyncStatusPill state={{ kind: "error", message: "Token avvisad" } as SyncState} />);
    expect(screen.getByText(/Synk-fel/)).toBeInTheDocument();
    expect(screen.getByRole("link").getAttribute("title")).toBe("Token avvisad");
  });

  it("klick leder alltid till /settings", () => {
    render(<SyncStatusPill state={{ kind: "idle" } as SyncState} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/settings");
  });
});
