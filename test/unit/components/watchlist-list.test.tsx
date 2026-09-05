import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { WatchlistList } from "@/components/watchlist/watchlist-list";
import type { WatchlistItem } from "@/lib/shared/watchlist";

function item(p: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    kind: "deadline", severity: "approaching",
    title: "Tidsfrist om 3 dagar: Ge in yttrande",
    detail: "Förfaller 2026-09-08.",
    matterId: "m1", matterNumber: "2026-0001",
    at: "2026-09-08", amountOre: null, href: "/matters/m1", ...p,
  };
}

describe("WatchlistList", () => {
  it("visar tomt-text när inget behöver bevakas", () => {
    render(<WatchlistList items={[]} emptyText="Inget att bevaka just nu." />);
    expect(screen.getByText("Inget att bevaka just nu.")).toBeInTheDocument();
  });

  it("visar rubrik, detalj och ärendenummer", () => {
    render(<WatchlistList items={[item()]} emptyText="" />);
    expect(screen.getByText(/Ge in yttrande/)).toBeInTheDocument();
    expect(screen.getByText(/Förfaller 2026-09-08/)).toBeInTheDocument();
    expect(screen.getByText("2026-0001")).toBeInTheDocument();
  });

  it("länkar dit man åtgärdar posten", () => {
    render(<WatchlistList items={[item()]} emptyText="" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/matters/m1");
  });

  it("visar belopp när posten har ett", () => {
    render(<WatchlistList items={[item({ amountOre: 2_500_000, kind: "unbilled" })]} emptyText="" />);
    expect(screen.getByText(/25 000,00/)).toBeInTheDocument();
  });

  // Färgen bär samma information som sorteringen, men får inte vara den enda
  // bäraren — allvarsgraden ska gå att uppfatta utan att se färg.
  it("skiljer passerat från annalkande visuellt", () => {
    const { container: passerat } = render(
      <WatchlistList items={[item({ severity: "passed" })]} emptyText="" />,
    );
    expect(passerat.querySelector("a")?.className).toContain("red");

    const { container: annalkande } = render(
      <WatchlistList items={[item({ severity: "approaching" })]} emptyText="" />,
    );
    expect(annalkande.querySelector("a")?.className).toContain("amber");
  });

  it("namnger signaltypen för skärmläsare", () => {
    render(<WatchlistList items={[item({ kind: "failedDispatch" })]} emptyText="" />);
    expect(screen.getByText(/Utskick misslyckades:/)).toBeInTheDocument();
  });

  it("renderar flera poster utan nyckelkrock när ärende och datum saknas", () => {
    render(
      <WatchlistList
        items={[
          item({ matterId: null, matterNumber: null, at: null }),
          item({ matterId: null, matterNumber: null, at: null }),
        ]}
        emptyText=""
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
