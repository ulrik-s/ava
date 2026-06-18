/**
 * Test för ProfilePage — egen profil: uppgifts-formulär (hydreras från
 * user.current) + Spara. (SSH-nyckel-hanteringen togs bort med git-vägen;
 * server-first identifierar via OIDC.) IntegrationsSection stubbas (testas separat).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import ProfilePage from "@/app/profile/page";

vi.mock("@/components/settings/integrations-section", () => ({
  IntegrationsSection: () => <div data-testid="integrations-stub" />,
}));

const meData = {
  id: "u1",
  name: "Anna Advokat",
  title: "Advokat",
  email: "anna@firma.se",
  role: "LAWYER",
};
const meQuery = { data: meData as unknown, isLoading: false };
const updateMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ user: { current: { invalidate: vi.fn() } } }),
    user: {
      current: { useQuery: () => meQuery },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false, error: null }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfilePage", () => {
  it("renderar rubrik + hydrerar formuläret från user.current", async () => {
    render(<ProfilePage />);
    expect(screen.getByText("Min profil")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Anna Advokat")).toBeInTheDocument();
    expect(screen.getByDisplayValue("anna@firma.se")).toBeInTheDocument();
  });

  it("renderar anslutna tjänster (IntegrationsSection)", () => {
    render(<ProfilePage />);
    expect(screen.getByTestId("integrations-stub")).toBeInTheDocument();
  });

  it("nämner inte längre SSH-nycklar / commit-signering", () => {
    render(<ProfilePage />);
    expect(screen.queryByText(/signera dina commits/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Publika nycklar/)).not.toBeInTheDocument();
  });

  it("Spara → update.mutate med formulärvärdena", async () => {
    render(<ProfilePage />);
    await screen.findByDisplayValue("Anna Advokat");
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/ }));
    expect(updateMutate).toHaveBeenCalledWith({
      id: "u1",
      name: "Anna Advokat",
      title: "Advokat",
      email: "anna@firma.se",
    });
  });
});
