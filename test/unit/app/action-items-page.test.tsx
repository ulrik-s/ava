import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import ActionItemsPage from "@/app/action-items/page";
import type { WatchlistItem } from "@/lib/shared/watchlist";

const query: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
/** Senaste argumenten till useQuery — så "Bara mina ärenden" går att verifiera. */
let lastArgs: unknown = null;

vi.mock("@/components/sync/stale-devices-notice", () => ({ StaleDevicesNotice: () => <p>stale-devices-stub</p> }));
vi.mock("@/components/sync/rejected-changes-notice", () => ({ RejectedChangesNotice: () => <p>rejected-changes-stub</p> }));
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    watchlist: {
      actionItems: {
        useQuery: (args: unknown) => {
          lastArgs = args;
          return query;
        },
      },
    },
  },
}));

function item(p: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    kind: "conflictCheck", severity: "passed", title: "Jävskontroll: 2 träffar att bedöma", detail: "d",
    matterId: "m1", matterNumber: "2026-0001", at: null,
    amountOre: null, link: { route: "matters", id: "m1" }, ...p,
  };
}

beforeEach(() => {
  query.data = { items: [] };
  query.isLoading = false;
  lastArgs = null;
});

describe("Att åtgärda-sidan (#1734)", () => {
  it("visar rubriken och synkrutorna", () => {
    render(<ActionItemsPage />);
    expect(screen.getByRole("heading", { name: "Att åtgärda" })).toBeInTheDocument();
    expect(screen.getByText("stale-devices-stub")).toBeInTheDocument();
    expect(screen.getByText("rejected-changes-stub")).toBeInTheDocument();
  });

  it("säger att inget behöver åtgärdas", () => {
    render(<ActionItemsPage />);
    expect(screen.getByText("0 poster.")).toBeInTheDocument();
    expect(screen.getByText("Inget att åtgärda just nu.")).toBeInTheDocument();
  });

  it("visar Hämtar… medan frågan laddar", () => {
    query.data = undefined;
    query.isLoading = true;
    render(<ActionItemsPage />);
    expect(screen.getByText("Hämtar…")).toBeInTheDocument();
  });

  it("listar posterna med länk till ärendet", () => {
    query.data = { items: [item(), item({ kind: "coverageCap", title: "Rättshjälpstaket nära", matterId: "m2", link: { route: "matters", id: "m2" } })] };
    render(<ActionItemsPage />);
    expect(screen.getByText("2 poster.")).toBeInTheDocument();
    expect(screen.getByText(/Jävskontroll: 2 träffar att bedöma/)).toBeInTheDocument();
    expect(screen.getByText(/Rättshjälpstaket nära/)).toBeInTheDocument();
    const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("m1"))).toBe(true);
    expect(hrefs.some((h) => h.includes("m2"))).toBe(true);
  });

  it("Bara mina ärenden är förvald och går att slå av", () => {
    render(<ActionItemsPage />);
    expect(lastArgs).toEqual({ mine: true });
    fireEvent.click(screen.getByLabelText(/Bara mina ärenden/i));
    expect(lastArgs).toEqual({ mine: false });
  });
});
