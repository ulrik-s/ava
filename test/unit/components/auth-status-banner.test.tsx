/**
 * Tester för `AuthStatusBanner` — visar auth-mode i top-baren.
 *
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { AuthStatusBanner } from "@/components/shell/auth-status-banner";
import { fakeTrpcLink, TrpcTestProvider } from "../../helpers/trpc-fake";

const mockState = {
  mode: "anonymous" as "anonymous" | "identified-read" | "identified-write",
  user: null as null | { login: string; id: number },
  loading: false,
  error: null,
  shouldRequireLogin: false,
  refresh: async () => {},
};

// ADR 0027: bannern visar den faktiska principalen (user.current).
let currentUser: { name?: string; email?: string } | undefined;

vi.mock("@/lib/client/auth/use-auth-mode", () => ({
  useAuthMode: () => mockState,
}));

/** Renderar bannern under en fejkad tRPC-länk som svarar med `currentUser`. */
function renderBanner() {
  const fake = fakeTrpcLink({ "user.current": () => currentUser ?? null });
  return render(<TrpcTestProvider link={fake.link}><AuthStatusBanner /></TrpcTestProvider>);
}

describe("AuthStatusBanner", () => {
  beforeEach(() => { currentUser = undefined; mockState.user = null; });

  it("renderar inget medan auth-mode laddas", () => {
    mockState.loading = true;
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
    mockState.loading = false;
  });

  it("anonymous → 'Demo-läge — endast läsning'", () => {
    mockState.mode = "anonymous";
    renderBanner();
    expect(screen.getByText(/Demo-läge — endast läsning/i)).toBeInTheDocument();
  });

  it("visar principalens namn (user.current) — inte GitHub-login", async () => {
    mockState.mode = "identified-write";
    currentUser = { name: "Björn Bauer", email: "lawyer@ava.test" };
    renderBanner();
    expect(await screen.findByText(/Inloggad som Björn Bauer — kan spara/i)).toBeInTheDocument();
  });

  it("faller tillbaka på email när namn saknas", async () => {
    mockState.mode = "identified-read";
    currentUser = { email: "x@y.se" };
    renderBanner();
    expect(await screen.findByText(/Inloggad som x@y\.se — endast läsning/i)).toBeInTheDocument();
  });

  it("klick leder till /settings (Link-href)", () => {
    mockState.mode = "anonymous";
    renderBanner();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/settings");
  });

  it("fallback till 'okänd' om varken principal eller legacy-login finns", () => {
    mockState.mode = "identified-read";
    renderBanner();
    expect(screen.getByText(/Inloggad som okänd/i)).toBeInTheDocument();
  });
});
