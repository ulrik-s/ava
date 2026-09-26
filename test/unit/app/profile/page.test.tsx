/**
 * Test för ProfilePage — egen profil: uppgifts-formulär (hydreras från
 * user.current) + Spara. (SSH-nyckel-hanteringen togs bort med git-vägen;
 * server-first identifierar via OIDC.) IntegrationsSection stubbas (testas separat).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import ProfilePage from "@/app/profile/page";

// Dockytan (#1184) kräver en riktig webbläsarlayout — här renderas huvudet och
// alla paneler efter varandra, synkront, så testerna kan granska innehållet.
vi.mock("@/components/layout/panel-page", () => ({
  PanelPage: ({ header, panels }: { header: React.ReactNode; panels: ReadonlyArray<{ id: string; render: () => React.ReactNode }> }) => (
    <>{header}{panels.map((p) => <div key={p.id} data-panel={p.id}>{p.render()}</div>)}</>
  ),
}));

const integrations = { available: true };
vi.mock("@/components/settings/integrations-section", () => ({
  IntegrationsSection: () => <div data-testid="integrations-stub" />,
  useIntegrationsAvailable: () => integrations.available,
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
    integrations.available = true;
    render(<ProfilePage />);
    expect(screen.getByTestId("integrations-stub")).toBeInTheDocument();
  });

  it("utan tillgängliga integrationer finns ingen tom Anslutna tjänster-panel (#1213)", () => {
    integrations.available = false;
    const { container } = render(<ProfilePage />);
    expect(container.querySelector('[data-panel="integrations"]')).toBeNull();
    integrations.available = true;
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
