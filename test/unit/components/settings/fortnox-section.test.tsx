import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { FortnoxSection } from "@/components/settings/fortnox-section";

interface Status { configured: boolean; connected: boolean; reconnectRequired: boolean; renewedAt: Date | null; expiresAt: Date | null }
const NONE = { reconnectRequired: false, renewedAt: null, expiresAt: null };
const status: { data: Status | undefined } = { data: undefined };
const me: { data: { role: string } | undefined } = { data: undefined };
const connect = { mutate: vi.fn(), isPending: false, error: null as { message: string } | null };

vi.mock("@/lib/client/trpc", () => ({
  trpc: { user: { current: { useQuery: () => me } } },
}));
vi.mock("@/lib/client/backend/server-ledger", () => ({
  useLedgerStatus: () => status,
  useConnectLedger: () => connect,
}));

beforeEach(() => {
  vi.clearAllMocks();
  status.data = { configured: true, connected: false, ...NONE };
  me.data = { role: "ADMIN" };
  connect.isPending = false;
  connect.error = null;
});

describe("FortnoxSection", () => {
  it("döljs när servern saknar Fortnox", () => {
    status.data = { configured: false, connected: false, ...NONE };
    const { container } = render(<FortnoxSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("admin kan ansluta", () => {
    render(<FortnoxSection />);
    expect(screen.getByText("inte ansluten")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anslut Fortnox" }));
    expect(connect.mutate).toHaveBeenCalled();
  });

  it("ansluten visar status och 'Anslut igen'", () => {
    status.data = { configured: true, connected: true, ...NONE };
    render(<FortnoxSection />);
    expect(screen.getByText("ansluten ✓")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anslut igen" })).toBeInTheDocument();
    // Utan känd förnyelse: bara "ansluten ✓" (#1816).
    expect(screen.queryByText(/Senast förnyad/)).not.toBeInTheDocument();
  });

  it("ansluten med förnyelse visar svenska kalenderdagar (#1816)", () => {
    // 22:30 UTC = 00:30 svensk tid dagen efter: dagen ska vara Stockholms.
    status.data = {
      configured: true, connected: true, reconnectRequired: false,
      renewedAt: new Date("2026-06-01T22:30:00Z"), expiresAt: new Date("2026-07-16T22:30:00Z"),
    };
    render(<FortnoxSection />);
    expect(screen.getByText("ansluten ✓")).toBeInTheDocument();
    expect(screen.getByText("Senast förnyad 2026-06-02 · går ut ca 2026-07-17")).toBeInTheDocument();
  });

  it("måste anslutas igen: röd status, förklaring och 'Anslut igen' för admin (#1816)", () => {
    status.data = { configured: true, connected: false, reconnectRequired: true, renewedAt: new Date("2026-06-01T10:00:00Z"), expiresAt: null };
    render(<FortnoxSection />);
    expect(screen.getByText("måste anslutas igen")).toHaveClass("text-red-700");
    expect(screen.getByText(/Fortnox godtog inte förnyelsen\. Bokföringen till Fortnox fungerar inte förrän en administratör ansluter igen\./)).toBeInTheDocument();
    expect(screen.queryByText("ansluten ✓")).not.toBeInTheDocument();
    expect(screen.queryByText(/Senast förnyad/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anslut igen" }));
    expect(connect.mutate).toHaveBeenCalled();
  });

  it("icke-admin ser status men ingen knapp; fel visas", () => {
    me.data = { role: "LAWYER" };
    connect.error = { message: "nej" };
    render(<FortnoxSection />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("nej");
  });
});
