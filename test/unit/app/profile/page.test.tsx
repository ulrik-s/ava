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
  vehicleType: null as string | null,
  mileageRate: null as number | null,
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
  meData.vehicleType = null;
  meData.mileageRate = null;
});

describe("ProfilePage", () => {
  it("renderar rubrik + hydrerar formuläret från user.current", async () => {
    render(<ProfilePage />);
    expect(screen.getByText("Min profil")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Anna Advokat")).toBeInTheDocument();
    // E-posten visas men går inte att redigera (#1371).
    expect(screen.getByText("anna@firma.se")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("anna@firma.se")).not.toBeInTheDocument();
    expect(screen.getByText(/används för inloggningen/)).toBeInTheDocument();
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

  it("Spara → update.mutate med formulärvärdena, utan e-post (#1371)", async () => {
    render(<ProfilePage />);
    await screen.findByDisplayValue("Anna Advokat");
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/ }));
    expect(updateMutate).toHaveBeenCalledWith({
      id: "u1",
      name: "Anna Advokat",
      title: "Advokat",
      vehicleType: null,
      mileageRate: null,
    });
  });
});

describe("ProfilePage — biltyp och milersättning (#1528)", () => {
  it("visar Biltyp med tre val och Milersättning (kr/mil)", async () => {
    render(<ProfilePage />);
    await screen.findByDisplayValue("Anna Advokat");
    const select = screen.getByLabelText("Biltyp");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Ingen vald", "Egen bil", "Förmånsbil, helt el", "Förmånsbil, ej helt el",
    ]);
    expect(screen.getByLabelText("Milersättning (kr/mil)")).toHaveValue("");
  });

  it("val av biltyp fyller i Skatteverkets nivå", async () => {
    render(<ProfilePage />);
    await screen.findByDisplayValue("Anna Advokat");
    const select = screen.getByLabelText("Biltyp");
    const rate = screen.getByLabelText("Milersättning (kr/mil)");
    fireEvent.change(select, { target: { value: "OWN_CAR" } });
    expect(rate).toHaveValue("25");
    fireEvent.change(select, { target: { value: "COMPANY_CAR_ELECTRIC" } });
    expect(rate).toHaveValue("9.5");
    fireEvent.change(select, { target: { value: "COMPANY_CAR_OTHER" } });
    expect(rate).toHaveValue("12");
    // "Ingen vald" behåller beloppet.
    fireEvent.change(select, { target: { value: "" } });
    expect(rate).toHaveValue("12");
  });

  it("överskrivet belopp (decimalkomma) sparas i öre/km tillsammans med biltypen", async () => {
    render(<ProfilePage />);
    await screen.findByDisplayValue("Anna Advokat");
    fireEvent.change(screen.getByLabelText("Biltyp"), { target: { value: "OWN_CAR" } });
    fireEvent.change(screen.getByLabelText("Milersättning (kr/mil)"), { target: { value: "18,50" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/ }));
    expect(updateMutate).toHaveBeenCalledWith(expect.objectContaining({ vehicleType: "OWN_CAR", mileageRate: 185 }));
  });

  it("sparat värde visas när profilen laddas", async () => {
    meData.vehicleType = "COMPANY_CAR_ELECTRIC";
    meData.mileageRate = 95;
    render(<ProfilePage />);
    await screen.findByDisplayValue("Anna Advokat");
    expect(screen.getByLabelText("Biltyp")).toHaveValue("COMPANY_CAR_ELECTRIC");
    expect(screen.getByLabelText("Milersättning (kr/mil)")).toHaveValue("9.5");
  });
});
