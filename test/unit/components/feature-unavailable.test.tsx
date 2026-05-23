/**
 * Tester för `FeatureUnavailable`.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureUnavailable } from "@/components/feature-unavailable";

describe("FeatureUnavailable", () => {
  it("renderar title + description", () => {
    render(<FeatureUnavailable title="Rapporter" description="Visar omsättning per advokat." />);
    expect(screen.getByRole("heading", { name: "Rapporter" })).toBeInTheDocument();
    expect(screen.getByText("Visar omsättning per advokat.")).toBeInTheDocument();
  });

  it("visar 'Inte tillgängligt i demo-läget'-meddelande", () => {
    render(<FeatureUnavailable title="X" description="y" />);
    expect(screen.getByText(/Inte tillgängligt i demo-läget/i)).toBeInTheDocument();
  });

  it("listar genvägar till fungerande delar", () => {
    render(<FeatureUnavailable title="X" description="y" />);
    expect(screen.getByRole("link", { name: /Ärenden/ })).toHaveAttribute("href", "/matters");
    expect(screen.getByRole("link", { name: /Kontakter/ })).toHaveAttribute("href", "/contacts");
    expect(screen.getByRole("link", { name: /Fakturor/ })).toHaveAttribute("href", "/invoices");
    expect(screen.getByRole("link", { name: /Tidregistrering/ })).toHaveAttribute("href", "/time");
    expect(screen.getByRole("link", { name: /Rapporter/ })).toHaveAttribute("href", "/reports");
  });
});
