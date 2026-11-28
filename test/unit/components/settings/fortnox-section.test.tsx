import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { FortnoxSection } from "@/components/settings/fortnox-section";
import { renderWithFakeTrpc, settled } from "../../../helpers/trpc-both-fake";

interface Status { configured: boolean; connected: boolean; reconnectRequired: boolean; renewedAt: Date | null; expiresAt: Date | null }
const NONE = { reconnectRequired: false, renewedAt: null, expiresAt: null };
const status: { data: Status | undefined } = { data: undefined };
const me: { data: { role: string } | undefined } = { data: undefined };
const connect = { mutate: vi.fn(), isPending: false, error: null as { message: string } | null };

vi.mock("@/lib/client/backend/server-ledger", () => ({
  useLedgerStatus: () => status,
  useConnectLedger: () => connect,
}));

/** Renderar sektionen och väntar tills `user.current` svarat. */
async function renderSection() {
  const view = renderWithFakeTrpc(<FortnoxSection />, { "user.current": () => me.data ?? null });
  await settled(view);
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  status.data = { configured: true, connected: false, ...NONE };
  me.data = { role: "ADMIN" };
  connect.isPending = false;
  connect.error = null;
});

describe("FortnoxSection", () => {
  it("döljs när servern saknar Fortnox", async () => {
    status.data = { configured: false, connected: false, ...NONE };
    const { container } = await renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("admin kan ansluta", async () => {
    await renderSection();
    expect(screen.getByText("inte ansluten")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anslut Fortnox" }));
    expect(connect.mutate).toHaveBeenCalled();
  });

  it("ansluten visar status och 'Anslut igen'", async () => {
    status.data = { configured: true, connected: true, ...NONE };
    await renderSection();
    expect(screen.getByText("ansluten ✓")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anslut igen" })).toBeInTheDocument();
    // Utan känd förnyelse: bara "ansluten ✓" (#1816).
    expect(screen.queryByText(/Senast förnyad/)).not.toBeInTheDocument();
  });

  it("ansluten med förnyelse visar svenska kalenderdagar (#1816)", async () => {
    // 22:30 UTC = 00:30 svensk tid dagen efter: dagen ska vara Stockholms.
    status.data = {
      configured: true, connected: true, reconnectRequired: false,
      renewedAt: new Date("2026-06-01T22:30:00Z"), expiresAt: new Date("2026-07-16T22:30:00Z"),
    };
    await renderSection();
    expect(screen.getByText("ansluten ✓")).toBeInTheDocument();
    expect(screen.getByText("Senast förnyad 2026-06-02 · går ut ca 2026-07-17")).toBeInTheDocument();
  });

  it("måste anslutas igen: röd status, förklaring och 'Anslut igen' för admin (#1816)", async () => {
    status.data = { configured: true, connected: false, reconnectRequired: true, renewedAt: new Date("2026-06-01T10:00:00Z"), expiresAt: null };
    await renderSection();
    expect(screen.getByText("måste anslutas igen")).toHaveClass("text-red-700");
    expect(screen.getByText(/Fortnox godtog inte förnyelsen\. Bokföringen till Fortnox fungerar inte förrän en administratör ansluter igen\./)).toBeInTheDocument();
    expect(screen.queryByText("ansluten ✓")).not.toBeInTheDocument();
    expect(screen.queryByText(/Senast förnyad/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anslut igen" }));
    expect(connect.mutate).toHaveBeenCalled();
  });

  it("icke-admin ser status men ingen knapp; fel visas", async () => {
    me.data = { role: "LAWYER" };
    connect.error = { message: "nej" };
    await renderSection();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("nej");
  });
});
