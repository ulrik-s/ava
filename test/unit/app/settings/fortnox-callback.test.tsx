import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import FortnoxCallbackPage from "@/app/settings/fortnox/page";

let params = new URLSearchParams();
const complete = { mutate: vi.fn(), isSuccess: false, error: null as { message: string } | null };

vi.mock("next/navigation", () => ({ useSearchParams: () => params }));
vi.mock("@/lib/client/backend/server-ledger", () => ({ useCompleteLedgerConnect: () => complete }));

beforeEach(() => {
  vi.clearAllMocks();
  params = new URLSearchParams("code=c1&state=s1");
  complete.isSuccess = false;
  complete.error = null;
});

describe("Fortnox-callback", () => {
  it("växlar in koden en gång och visar pågående", () => {
    const { rerender } = render(<FortnoxCallbackPage />);
    rerender(<FortnoxCallbackPage />);
    expect(complete.mutate).toHaveBeenCalledTimes(1);
    expect(complete.mutate).toHaveBeenCalledWith({ code: "c1", state: "s1" });
    expect(screen.getByText("Ansluter till Fortnox…")).toBeInTheDocument();
  });

  it("lyckad anslutning", () => {
    complete.isSuccess = true;
    render(<FortnoxCallbackPage />);
    expect(screen.getByText("Fortnox är anslutet ✓")).toBeInTheDocument();
  });

  it("serverfel visas", () => {
    complete.error = { message: "utgången" };
    render(<FortnoxCallbackPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Kunde inte ansluta: utgången");
  });

  it("nekad i Fortnox → avbruten, inget anrop", () => {
    params = new URLSearchParams("error=access_denied");
    render(<FortnoxCallbackPage />);
    expect(screen.getByText("Anslutningen avbröts (access_denied).")).toBeInTheDocument();
    expect(complete.mutate).not.toHaveBeenCalled();
  });

  it("saknad kod → avbruten", () => {
    params = new URLSearchParams();
    render(<FortnoxCallbackPage />);
    expect(screen.getByText("Anslutningen avbröts.")).toBeInTheDocument();
  });
});
