/**
 * `LedgerReconnectBanner` (#1816) — admin får en banner på alla sidor när
 * Fortnox-anslutningen måste göras om.
 */
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { LedgerReconnectBanner } from "@/components/shell/ledger-reconnect-banner";
import { renderWithFakeTrpc, settled } from "../../helpers/trpc-both-fake";

const status: { data: { reconnectRequired: boolean } | undefined } = { data: undefined };
const me: { data: { role: string } | undefined } = { data: undefined };

vi.mock("@/lib/client/backend/server-ledger", () => ({
  useLedgerStatus: () => status,
}));

/** Renderar bannern och väntar tills `user.current` svarat. */
async function renderBanner() {
  const view = renderWithFakeTrpc(<LedgerReconnectBanner />, { "user.current": () => me.data ?? null });
  await settled(view);
  return view;
}

beforeEach(() => {
  status.data = { reconnectRequired: true };
  me.data = { role: "ADMIN" };
});

describe("LedgerReconnectBanner", () => {
  it("admin + måste anslutas igen: synlig banner med länk till Bokföring i Inställningar", async () => {
    await renderBanner();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Fortnox-anslutningen har gått ut. Bokföringen till Fortnox fungerar inte förrän du ansluter igen.",
    );
    expect(screen.getByRole("link", { name: "Anslut igen" })).toHaveAttribute("href", "/settings#ledger");
    // Går inte att stänga.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("annan roll ser ingen banner", async () => {
    me.data = { role: "LAWYER" };
    const { container } = await renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("ansluten ger ingen banner", async () => {
    status.data = { reconnectRequired: false };
    const { container } = await renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("ingen status (demo, eller innan svaret kommit) ger ingen banner", async () => {
    status.data = undefined;
    me.data = undefined;
    const { container } = await renderBanner();
    expect(container).toBeEmptyDOMElement();
  });
});
