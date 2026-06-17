/**
 * `ExternalActionBadge` (#417) — online-only-handlings-indikator.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { ExternalActionBadge } from "@/components/shell/external-action-badge";

describe("ExternalActionBadge", () => {
  it("pending → 'Skickas när du är online igen'", () => {
    render(<ExternalActionBadge status="pending" />);
    const badge = screen.getByTestId("external-action-badge");
    expect(badge).toHaveAttribute("data-status", "pending");
    expect(badge.textContent).toContain("Skickas när du är online igen");
  });
  it("done → 'Skickad'", () => {
    render(<ExternalActionBadge status="done" />);
    expect(screen.getByTestId("external-action-badge").textContent).toContain("Skickad");
  });
  it("failed → 'Misslyckades — försök igen'", () => {
    render(<ExternalActionBadge status="failed" />);
    expect(screen.getByTestId("external-action-badge").textContent).toContain("Misslyckades");
  });
});
