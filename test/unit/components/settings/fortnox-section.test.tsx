import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { FortnoxSection } from "@/components/settings/fortnox-section";

const status: { data: { configured: boolean; connected: boolean } | undefined } = { data: undefined };
const me: { data: { role: string } | undefined } = { data: undefined };
const connect = { mutate: vi.fn(), isPending: false, error: null as { message: string } | null };
let onSuccess: ((r: { url: string }) => void) | undefined;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    ledger: {
      status: { useQuery: () => status },
      connectUrl: { useMutation: (o: { onSuccess: (r: { url: string }) => void }) => { onSuccess = o.onSuccess; return connect; } },
    },
    user: { current: { useQuery: () => me } },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  status.data = { configured: true, connected: false };
  me.data = { role: "ADMIN" };
  connect.isPending = false;
  connect.error = null;
});

describe("FortnoxSection", () => {
  it("döljs när servern saknar Fortnox", () => {
    status.data = { configured: false, connected: false };
    const { container } = render(<FortnoxSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("admin kan ansluta; svaret skickar vidare till Fortnox", () => {
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { value: { ...orig, assign }, configurable: true });
    render(<FortnoxSection />);
    expect(screen.getByText("inte ansluten")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anslut Fortnox" }));
    expect(connect.mutate).toHaveBeenCalled();
    onSuccess?.({ url: "https://apps.fortnox.se/oauth-v1/auth?x" });
    expect(assign).toHaveBeenCalledWith("https://apps.fortnox.se/oauth-v1/auth?x");
    Object.defineProperty(window, "location", { value: orig, configurable: true });
  });

  it("ansluten visar status och 'Anslut igen'", () => {
    status.data = { configured: true, connected: true };
    render(<FortnoxSection />);
    expect(screen.getByText("ansluten ✓")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anslut igen" })).toBeInTheDocument();
  });

  it("icke-admin ser status men ingen knapp; fel visas", () => {
    me.data = { role: "LAWYER" };
    connect.error = { message: "nej" };
    render(<FortnoxSection />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("nej");
  });
});
