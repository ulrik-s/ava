/**
 * Tester för `AppShell` — wrapper:n som mountar Sidebar + main runt
 * sidornas innehåll.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/shell/app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const currentQuery = { data: undefined as { name?: string } | undefined };
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    user: {
      current: { useQuery: () => currentQuery },
    },
    // ExternalEditRegistrar (mountad av AppShell) anropar trpc.useUtils().
    // Resultatet derefereras bara i en FSA-event-callback (ej vid render).
    useUtils: () => ({}),
  },
}));

describe("AppShell", () => {
  it("renderar Sidebar med användarnamn när tillgängligt", () => {
    currentQuery.data = { name: "Anna Advokat" };
    render(<AppShell>barn</AppShell>);
    // Sidebar har länkar för varje nav-item — "Dashboard" är första
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Anna Advokat").length).toBeGreaterThan(0);
  });

  it("renderar barn-content som main", () => {
    currentQuery.data = undefined;
    render(<AppShell><div data-testid="page-content">Innehåll</div></AppShell>);
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
  });

  it("ger Att göra-länk i sidebar (ersatt Kalender i UX:n)", () => {
    currentQuery.data = { name: "X" };
    render(<AppShell>x</AppShell>);
    // Två förekomster (mobil + desktop) — räkna att minst en finns
    expect(screen.getAllByRole("link", { name: /Att göra/i }).length).toBeGreaterThan(0);
  });

  it("tål null/undefined user.current utan att krascha", () => {
    currentQuery.data = undefined;
    expect(() => render(<AppShell>x</AppShell>)).not.toThrow();
  });
});
