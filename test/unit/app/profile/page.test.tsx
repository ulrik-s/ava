/**
 * Test för ProfilePage — egen profil: uppgifts-formulär (hydreras från
 * user.current) + publika nycklar (lista, ta bort, manuell paste-add).
 *
 * KeypairManager (WebCrypto/IndexedDB) och IntegrationsSection (tRPC) stubbas
 * — de testas separat; här verifierar vi profil-sidans egen logik.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import ProfilePage from "@/app/profile/page";

vi.mock("@/components/settings/keypair-manager", () => ({
  KeypairManager: () => <div data-testid="keypair-manager-stub" />,
}));
vi.mock("@/components/settings/integrations-section", () => ({
  IntegrationsSection: () => <div data-testid="integrations-stub" />,
}));

const meData = {
  id: "u1",
  name: "Anna Advokat",
  title: "Advokat",
  email: "anna@firma.se",
  role: "LAWYER",
  publicKeys: [
    { fingerprint: "SHA256:abc123", type: "ssh-ed25519", comment: "mac", addedAt: "2026-01-01T00:00:00Z" },
  ],
};
const meQuery = { data: meData as unknown, isLoading: false };
const updateMutate = vi.fn();
const addMutate = vi.fn();
const removeMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ user: { current: { invalidate: vi.fn() } } }),
    user: {
      current: { useQuery: () => meQuery },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false, error: null }) },
      addKey: { useMutation: () => ({ mutate: addMutate, isPending: false, error: null }) },
      removeKey: { useMutation: () => ({ mutate: removeMutate, isPending: false, error: null }) },
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

  it("visar registrerade nycklar", () => {
    render(<ProfilePage />);
    expect(screen.getByText("SHA256:abc123")).toBeInTheDocument();
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

  it("Lägg till nyckel öppnar paste-formuläret; Avbryt stänger det", async () => {
    render(<ProfilePage />);
    await screen.findByDisplayValue("Anna Advokat");
    fireEvent.click(screen.getByRole("button", { name: /Lägg till nyckel/ }));
    expect(screen.getByPlaceholderText(/ssh-ed25519 AAAA/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Avbryt/ }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/ssh-ed25519 AAAA/)).not.toBeInTheDocument());
  });

  it("Ta bort nyckel med confirm → removeKey.mutate", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProfilePage />);
    await screen.findByDisplayValue("Anna Advokat");
    fireEvent.click(screen.getByRole("button", { name: /Ta bort/ }));
    expect(removeMutate).toHaveBeenCalledWith({ fingerprint: "SHA256:abc123" });
    confirmSpy.mockRestore();
  });
});
