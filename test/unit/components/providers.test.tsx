/**
 * Smoke-test för Providers — verifierar att SessionProvider + tRPC + QueryClient
 * är monterade och att children renderas.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next-auth/react SessionProvider gör fetch på mount; mocka det.
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="session-provider">{children}</div>
  ),
}));

import { Providers } from "@/client/components/providers";

describe("Providers", () => {
  it("renderar children", () => {
    render(
      <Providers>
        <div data-testid="child">hej</div>
      </Providers>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("hej")).toBeInTheDocument();
  });

  it("wrappa children i SessionProvider", () => {
    render(
      <Providers>
        <span data-testid="kid">x</span>
      </Providers>,
    );
    const sp = screen.getByTestId("session-provider");
    expect(sp).toBeInTheDocument();
    expect(sp.querySelector('[data-testid="kid"]')).not.toBeNull();
  });

  it("monteras utan att kasta (tRPC + QueryClient initieras)", () => {
    expect(() =>
      render(
        <Providers>
          <span>ok</span>
        </Providers>,
      ),
    ).not.toThrow();
  });
});
