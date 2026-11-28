/**
 * Tester för `AppShell` — wrapper:n som mountar Sidebar + main runt
 * sidornas innehåll.
 */

import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { AppShell } from "@/components/shell/app-shell";
import { renderWithFakeTrpc } from "../../helpers/trpc-both-fake";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));
// "Nytt i AVA" (#2010) hämtar från servern; den har egna tester.
vi.mock("@/components/shell/release-notes", () => ({ ReleaseNotesLink: () => null, ReleaseNotesOnUpdate: () => null }));
// Bannern läser serverns bokföringsstatus; den har egna tester (#1816).
vi.mock("@/components/shell/ledger-reconnect-banner", () => ({ LedgerReconnectBanner: () => <div data-testid="ledger-reconnect-banner-stub" /> }));

const currentQuery = { data: undefined as { name?: string } | undefined };

/**
 * Renderar skalet under båda tRPC-bindningarna: AppShell läser `user.current`
 * med den nya, ExternalEditRegistrar (som skalet monterar) ännu med den klassiska.
 */
function renderShell(children: React.ReactNode) {
  return renderWithFakeTrpc(<AppShell>{children}</AppShell>, { "user.current": () => currentQuery.data ?? null });
}

describe("AppShell", () => {
  it("renderar Sidebar med användarnamn när tillgängligt", async () => {
    currentQuery.data = { name: "Anna Advokat" };
    renderShell("barn");
    // Sidebar har Startsida-knappen bredvid "AVA" (#1749)
    expect(screen.getAllByText("Startsida").length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Anna Advokat")).length).toBeGreaterThan(0);
  });

  // #1297: toppremsan (under 1024 px) ligger i flödet ovanför main — inte
  // fixed ovanpå bannrarna — så main behöver ingen utfyllnad för den.
  it("smala fönster: toppremsa och main staplas; main har ingen utfyllnad för en fast toppremsa", () => {
    currentQuery.data = undefined;
    const { container } = renderShell("barn");
    const main = container.querySelector("main");
    expect(main?.className).not.toContain("pt-16");
    expect(main?.parentElement?.className).toContain("flex-col");
    // Sida vid sida från 768 px: där står ikonmenyn till vänster (#1301).
    expect(main?.parentElement?.className).toContain("md:flex-row");
  });

  it("renderar barn-content som main", () => {
    currentQuery.data = undefined;
    renderShell(<div data-testid="page-content">Innehåll</div>);
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
  });

  it("sidebar: Frister, ingen Att bevaka, ingen Att göra (#1167) och ingen Kalender (#1623)", () => {
    currentQuery.data = { name: "X" };
    renderShell("x");
    // Två förekomster (mobil + desktop) — räkna att minst en finns
    expect(screen.getAllByRole("link", { name: /Frister/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Att bevaka/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Kalender/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Att göra/i })).not.toBeInTheDocument();
  });

  it("renderar bannern för Fortnox-anslutningen på alla sidor (#1816)", () => {
    currentQuery.data = undefined;
    renderShell("x");
    expect(screen.getByTestId("ledger-reconnect-banner-stub")).toBeInTheDocument();
  });

  it("tål null/undefined user.current utan att krascha", () => {
    currentQuery.data = undefined;
    expect(() => renderShell("x")).not.toThrow();
  });
});
