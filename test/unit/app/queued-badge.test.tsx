/**
 * `QueuedBadge` (#416) — per-post sync-läge-indikator.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { QueuedBadge } from "@/components/shell/queued-badge";

describe("QueuedBadge", () => {
  it("visar 'Köad' för queued", () => {
    render(<QueuedBadge status="queued" />);
    const badge = screen.getByTestId("queued-badge");
    expect(badge).toHaveAttribute("data-status", "queued");
    expect(badge.textContent).toContain("Köad");
  });

  it("visar 'Konflikt' för conflict", () => {
    render(<QueuedBadge status="conflict" />);
    expect(screen.getByTestId("queued-badge").textContent).toContain("Konflikt");
  });

  it("döljer 'synced' som default (mindre brus)", () => {
    render(<QueuedBadge status="synced" />);
    expect(screen.queryByTestId("queued-badge")).toBeNull();
  });

  it("visar 'Synkad' när showSynced=true", () => {
    render(<QueuedBadge status="synced" showSynced />);
    expect(screen.getByTestId("queued-badge").textContent).toContain("Synkad");
  });
});
