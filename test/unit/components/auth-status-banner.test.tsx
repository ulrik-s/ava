/**
 * Tester för `AuthStatusBanner` — visar auth-mode i top-baren.
 *
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { AuthStatusBanner } from "@/components/shell/auth-status-banner";

const mockState = {
  mode: "anonymous" as "anonymous" | "identified-read" | "identified-write",
  user: null as null | { login: string; id: number },
  loading: false,
  error: null,
  shouldRequireLogin: false,
  refresh: async () => {},
};

// ADR 0027: bannern visar den faktiska principalen (trpc.user.current).
let currentUser: { name?: string; email?: string } | undefined;

vi.mock("@/lib/client/auth/use-auth-mode", () => ({
  useAuthMode: () => mockState,
}));
vi.mock("@/lib/client/trpc", () => ({
  trpc: { user: { current: { useQuery: () => ({ data: currentUser }) } } },
}));

describe("AuthStatusBanner", () => {
  beforeEach(() => { currentUser = undefined; mockState.user = null; });

  it("renderar inget medan auth-mode laddas", () => {
    mockState.loading = true;
    const { container } = render(<AuthStatusBanner />);
    expect(container.firstChild).toBeNull();
    mockState.loading = false;
  });

  it("anonymous → 'Demo-läge — endast läsning'", () => {
    mockState.mode = "anonymous";
    render(<AuthStatusBanner />);
    expect(screen.getByText(/Demo-läge — endast läsning/i)).toBeInTheDocument();
  });

  it("visar principalens namn (trpc.user.current) — inte GitHub-login", () => {
    mockState.mode = "identified-write";
    currentUser = { name: "Björn Bauer", email: "lawyer@ava.test" };
    render(<AuthStatusBanner />);
    expect(screen.getByText(/Inloggad som Björn Bauer — kan spara/i)).toBeInTheDocument();
  });

  it("faller tillbaka på email när namn saknas", () => {
    mockState.mode = "identified-read";
    currentUser = { email: "x@y.se" };
    render(<AuthStatusBanner />);
    expect(screen.getByText(/Inloggad som x@y\.se — endast läsning/i)).toBeInTheDocument();
  });

  it("klick leder till /settings (Link-href)", () => {
    mockState.mode = "anonymous";
    render(<AuthStatusBanner />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/settings");
  });

  it("fallback till 'okänd' om varken principal eller legacy-login finns", () => {
    mockState.mode = "identified-read";
    render(<AuthStatusBanner />);
    expect(screen.getByText(/Inloggad som okänd/i)).toBeInTheDocument();
  });
});
