/**
 * `LedgerReconnectBanner` (#1816) — admin får en banner på alla sidor när
 * Fortnox-anslutningen måste göras om.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { LedgerReconnectBanner } from "@/components/shell/ledger-reconnect-banner";

const status: { data: { reconnectRequired: boolean } | undefined } = { data: undefined };
const me: { data: { role: string } | undefined } = { data: undefined };

vi.mock("@/lib/client/trpc", () => ({
  trpc: { user: { current: { useQuery: () => me } } },
}));
vi.mock("@/lib/client/backend/server-ledger", () => ({
  useLedgerStatus: () => status,
}));

beforeEach(() => {
  status.data = { reconnectRequired: true };
  me.data = { role: "ADMIN" };
});

describe("LedgerReconnectBanner", () => {
  it("admin + måste anslutas igen: synlig banner med länk till Bokföring i Inställningar", () => {
    render(<LedgerReconnectBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Fortnox-anslutningen har gått ut. Bokföringen till Fortnox fungerar inte förrän du ansluter igen.",
    );
    expect(screen.getByRole("link", { name: "Anslut igen" })).toHaveAttribute("href", "/settings#ledger");
    // Går inte att stänga.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("annan roll ser ingen banner", () => {
    me.data = { role: "LAWYER" };
    const { container } = render(<LedgerReconnectBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ansluten ger ingen banner", () => {
    status.data = { reconnectRequired: false };
    const { container } = render(<LedgerReconnectBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ingen status (demo, eller innan svaret kommit) ger ingen banner", () => {
    status.data = undefined;
    me.data = undefined;
    const { container } = render(<LedgerReconnectBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
