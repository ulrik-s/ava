/**
 * Test för UsersPage (lista).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import UsersPage from "@/app/users/page";

const usersQuery = {
  data: { users: [] as Array<Record<string, unknown>> },
  isLoading: false,
};
const currentQuery = {
  data: { id: "admin", role: "ADMIN" } as Record<string, unknown>,
  isLoading: false,
};
const deactivateMutation = {
  mutate: vi.fn(),
  isPending: false,
  error: null,
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    user: {
      list: { useQuery: () => usersQuery },
      current: { useQuery: () => currentQuery },
      deactivate: { useMutation: () => deactivateMutation },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ user: { list: { invalidate: vi.fn() } }, prefs: { get: { invalidate: vi.fn() } } }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  usersQuery.data = { users: [] };
  usersQuery.isLoading = false;
  currentQuery.data = { id: "admin", role: "ADMIN" };
});

const sampleUser = {
  id: "u1", name: "Anna Karlsson", title: "Advokat", email: "anna@x.se",
  role: "LAWYER", hourlyRate: 3000, mileageRate: 2500,
};

describe("UsersPage", () => {
  it("renderar rubrik + Ny användare-länk", () => {
    render(<UsersPage />);
    expect(screen.getByRole("heading", { name: /Användare/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\+ Ny användare/i })).toBeInTheDocument();
  });

  it("listar användare med korrekt roll-label", () => {
    usersQuery.data = {
      users: [
        {
          id: "u1",
          name: "Anna Karlsson",
          title: "Advokat",
          email: "anna@x.se",
          role: "LAWYER",
          hourlyRate: 3000,
          mileageRate: 2500,
        },
        {
          id: "u2",
          name: "Sofia Bergström",
          title: "Biträdande jurist",
          email: "sofia@x.se",
          role: "ASSISTANT",
          hourlyRate: 1800,
          mileageRate: null,
        },
      ],
    };
    render(<UsersPage />);
    expect(screen.getByText("Anna Karlsson")).toBeInTheDocument();
    expect(screen.getByText("Sofia Bergström")).toBeInTheDocument();
    // "Advokat" finns både som roll och titel — matcha minst en
    expect(screen.getAllByText("Advokat").length).toBeGreaterThan(0);
    expect(screen.getByText("Assistent")).toBeInTheDocument();
  });
});

describe("UsersPage — behörighet + inaktivera + status", () => {
  it("icke-admin: visar notis + döljer Ny användare-länk + actions", () => {
    currentQuery.data = { id: "u9", role: "LAWYER" };
    usersQuery.data = { users: [sampleUser] };
    render(<UsersPage />);
    expect(screen.getByText(/Endast administratörer/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /\+ Ny användare/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Inaktivera")).not.toBeInTheDocument();
  });

  it("admin: Inaktivera med confirm → deactivate.mutate med id", () => {
    usersQuery.data = { users: [sampleUser] }; // id "u1" ≠ current "admin"
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<UsersPage />);
    fireEvent.click(screen.getByText("Inaktivera"));
    expect(deactivateMutation.mutate).toHaveBeenCalledWith({ id: "u1" });
    confirmSpy.mockRestore();
  });

  it("admin: Inaktivera med avbruten confirm → ingen mutation", () => {
    usersQuery.data = { users: [sampleUser] };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<UsersPage />);
    fireEvent.click(screen.getByText("Inaktivera"));
    expect(deactivateMutation.mutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("egen rad får ingen Inaktivera-knapp (kan inte inaktivera sig själv)", () => {
    usersQuery.data = { users: [{ ...sampleUser, id: "admin" }] }; // = current user
    render(<UsersPage />);
    expect(screen.queryByText("Inaktivera")).not.toBeInTheDocument();
  });

  it("laddar-tillstånd visar 'Laddar...'", () => {
    usersQuery.isLoading = true;
    render(<UsersPage />);
    expect(screen.getByText("Laddar...")).toBeInTheDocument();
  });
});
