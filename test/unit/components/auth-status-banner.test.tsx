/**
 * Tester för `AuthStatusBanner` — visar auth-mode i top-baren.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthStatusBanner } from "@/components/shell/auth-status-banner";

const mockState = {
  mode: "anonymous" as "anonymous" | "identified-read" | "identified-write",
  user: null as null | { login: string; id: number },
  loading: false,
  error: null,
  shouldRequireLogin: false,
  refresh: async () => {},
};

vi.mock("@/client/lib/auth/use-auth-mode", () => ({
  useAuthMode: () => mockState,
}));

describe("AuthStatusBanner", () => {
  it("renderar inget medan auth-mode laddas", () => {
    mockState.loading = true;
    const { container } = render(<AuthStatusBanner />);
    expect(container.firstChild).toBeNull();
    mockState.loading = false;
  });

  it("anonymous → 'Demo-läge — endast läsning'", () => {
    mockState.mode = "anonymous";
    mockState.user = null;
    render(<AuthStatusBanner />);
    expect(screen.getByText(/Demo-läge — endast läsning/i)).toBeInTheDocument();
  });

  it("identified-read → '@user — endast läsning'", () => {
    mockState.mode = "identified-read";
    mockState.user = { login: "anna", id: 1 };
    render(<AuthStatusBanner />);
    expect(screen.getByText(/Inloggad som @anna — endast läsning/i)).toBeInTheDocument();
  });

  it("identified-write → '@user — kan spara'", () => {
    mockState.mode = "identified-write";
    mockState.user = { login: "ulrik", id: 2 };
    render(<AuthStatusBanner />);
    expect(screen.getByText(/Inloggad som @ulrik — kan spara/i)).toBeInTheDocument();
  });

  it("klick leder till /settings (Link-href)", () => {
    mockState.mode = "anonymous";
    render(<AuthStatusBanner />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/settings");
  });

  it("fallback till 'okänd' om user.login saknas", () => {
    mockState.mode = "identified-read";
    mockState.user = { login: undefined as unknown as string, id: 3 };
    render(<AuthStatusBanner />);
    expect(screen.getByText(/Inloggad som @okänd/i)).toBeInTheDocument();
  });
});
