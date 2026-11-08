/**
 * Tester för `SyncStatusPill` — renderar alla 7 sync-states.
 *
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { SyncStatusPill } from "@/components/shell/sync-status-pill";

describe("SyncStatusPill", () => {
  it("idle: 'Inte synkat ännu'", () => {
    render(<SyncStatusPill state={{ kind: "idle" }} />);
    expect(screen.getByText(/Inte synkat ännu/)).toBeInTheDocument();
  });

  it("synced: 'Sparat' + tooltip med relativ tid", () => {
    const now = Date.now();
    render(<SyncStatusPill state={{ kind: "synced", at: now }} />);
    expect(screen.getByText(/Sparat/)).toBeInTheDocument();
    expect(screen.getByRole("link").getAttribute("title")).toMatch(/just nu|sedan/i);
  });

  it("syncing pull: 'Hämtar…'", () => {
    render(<SyncStatusPill state={{ kind: "syncing", what: "pull" }} />);
    expect(screen.getByText(/Hämtar/)).toBeInTheDocument();
  });

  it("syncing push: 'Sparar…'", () => {
    render(<SyncStatusPill state={{ kind: "syncing", what: "push" }} />);
    expect(screen.getByText(/Sparar/)).toBeInTheDocument();
  });

  it("pending: räknar singular vs plural", () => {
    const { rerender } = render(<SyncStatusPill state={{ kind: "pending", count: 1 }} />);
    expect(screen.getByText(/1 ändring — sparas snart/)).toBeInTheDocument();
    rerender(<SyncStatusPill state={{ kind: "pending", count: 5 }} />);
    expect(screen.getByText(/5 ändringar — sparas snart/)).toBeInTheDocument();
  });

  it("offline med ändringar: visar count", () => {
    render(<SyncStatusPill state={{ kind: "offline", count: 3 }} />);
    expect(screen.getByText(/Off-line — 3 ändringar väntar/)).toBeInTheDocument();
  });

  it("offline utan ändringar: bara 'Off-line'", () => {
    render(<SyncStatusPill state={{ kind: "offline", count: 0 }} />);
    expect(screen.getByText(/^Off-line$/)).toBeInTheDocument();
  });

  it("rejected (#1266): antal avvisade, länkar till vyn där de hanteras", () => {
    const { rerender } = render(<SyncStatusPill state={{ kind: "rejected", count: 1 }} />);
    expect(screen.getByTestId("sync-pill")).toHaveTextContent("1 avvisad ändring");
    expect(screen.getByTestId("sync-pill")).toHaveAttribute("href", "/sync-conflicts");
    rerender(<SyncStatusPill state={{ kind: "rejected", count: 3 }} />);
    expect(screen.getByTestId("sync-pill")).toHaveTextContent("3 avvisade ändringar");
  });

  it("merge-needed: 'Merge behövs'", () => {
    render(<SyncStatusPill state={{ kind: "merge-needed" }} />);
    expect(screen.getByText(/Merge behövs/)).toBeInTheDocument();
  });

  it("error: visar 'Synk-fel — försöker igen' + felmeddelande i tooltip", () => {
    render(<SyncStatusPill state={{ kind: "error", message: "Token avvisad" }} />);
    expect(screen.getByText(/Synk-fel/)).toBeInTheDocument();
    expect(screen.getByRole("link").getAttribute("title")).toBe("Token avvisad");
  });

  it("klick leder alltid till /settings", () => {
    render(<SyncStatusPill state={{ kind: "idle" }} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/settings");
  });
});
