/**
 * Test för UsersPage (lista).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import UsersPage from "@/app/users/page";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import { rowOrder, sortColumn } from "../../../helpers/data-table";

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

/** onSuccess från user.deactivate — testet anropar den som servern hade gjort. */
let deactivated: (() => void) | undefined;
const listInvalidate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    user: {
      list: { useQuery: () => usersQuery },
      current: { useQuery: () => currentQuery },
      deactivate: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          deactivated = opts?.onSuccess;
          return deactivateMutation;
        },
      },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ user: { list: { invalidate: listInvalidate } }, prefs: { get: { invalidate: vi.fn() } } }),
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
  role: "LAWYER", hourlyRates: { ARBETE: 300000 }, mileageRate: 2500,
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
          hourlyRates: { ARBETE: 300000 },
          mileageRate: 250, // öre/km
        },
        {
          id: "u2",
          name: "Sofia Bergström",
          title: "Biträdande jurist",
          email: "sofia@x.se",
          role: "ASSISTANT",
          hourlyRates: {},
          mileageRate: null,
        },
      ],
    };
    render(<UsersPage />);
    // Eget timarvode visas; saknas det följer juristen byråns (#1206).
    expect(screen.getByText(/^3\s000 kr\/h$/)).toBeInTheDocument();
    expect(screen.getByText("byråns")).toBeInTheDocument();
    expect(screen.getByText("Anna Karlsson")).toBeInTheDocument();
    expect(screen.getByText("Sofia Bergström")).toBeInTheDocument();
    // "Advokat" finns både som roll och titel — matcha minst en
    expect(screen.getAllByText("Advokat").length).toBeGreaterThan(0);
    expect(screen.getByText("Assistent")).toBeInTheDocument();
    // Svenskt decimalkomma (#1309); kr/mil som Skatteverket (#1527) — förr "2,50 kr/km".
    expect(screen.getByText(/^25,00\s?kr\/mil$/)).toBeInTheDocument();
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

describe("UsersPage — Bli denna (#1109)", () => {
  it("demo: admin kan byta principal till en annan användare", () => {
    localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo" }));
    usersQuery.data = { users: [sampleUser] };
    render(<UsersPage />);
    expect(screen.getByText("Bli denna")).toBeInTheDocument();
  });

  it("OIDC: ingen Bli denna — principalen är serverns inloggade användare", () => {
    localStorage.setItem("ava.firma", JSON.stringify({ tier: "self-hosted" }));
    usersQuery.data = { users: [sampleUser] };
    render(<UsersPage />);
    expect(screen.queryByText("Bli denna")).not.toBeInTheDocument();
    expect(screen.getByText("Inaktivera")).toBeInTheDocument();
  });
});

// ── Kolumnerna, Bli denna och inaktiveringens svar (#1904) ──────────────

/** Tre användare där varje kolumn ger en egen ordning. */
const sortableUsers = (): Array<Record<string, unknown>> => [
  { id: "a", name: "Alva", title: "Delägare", email: "c@x.se", role: "LAWYER",
    hourlyRates: { ARBETE: 200000 }, mileageRate: 300 },
  { id: "b", name: "Bertil", title: null, email: "a@x.se", role: "ASSISTANT",
    hourlyRates: {}, mileageRate: null },
  { id: "c", name: "Cecilia", title: "Biträdande jurist", email: "b@x.se", role: "OKÄND",
    hourlyRates: { ARBETE: 100000 }, mileageRate: 250 },
];

describe("UsersPage — kolumnerna sorterar på det som visas (#1904)", () => {
  beforeEach(() => {
    usersQuery.data = { users: sortableUsers() };
  });

  const names = ["Alva", "Bertil", "Cecilia"];

  it("Namn, Titel och E-post", () => {
    render(<UsersPage />);
    sortColumn("Namn", "desc");
    expect(rowOrder(names)).toEqual(["Cecilia", "Bertil", "Alva"]);
    sortColumn("Titel", "asc");
    expect(rowOrder(names)).toEqual(["Bertil", "Cecilia", "Alva"]);
    sortColumn("E-post", "asc");
    expect(rowOrder(names)).toEqual(["Bertil", "Cecilia", "Alva"]);
  });

  it("Roll sorterar på etiketten och okänd roll på koden", () => {
    render(<UsersPage />);
    sortColumn("Roll", "desc");
    expect(rowOrder(names)).toEqual(["Cecilia", "Bertil", "Alva"]);
    expect(screen.getByText("OKÄND")).toBeInTheDocument();
  });

  it("Timarvode och Milersättning sorterar på beloppet, saknat belopp först", () => {
    render(<UsersPage />);
    sortColumn("Timarvode", "asc");
    expect(rowOrder(names)).toEqual(["Bertil", "Cecilia", "Alva"]);
    sortColumn("Milersättning", "desc");
    expect(rowOrder(names)).toEqual(["Alva", "Cecilia", "Bertil"]);
  });
});

describe("UsersPage — Bli denna och inaktiveringens svar (#1904)", () => {
  it("Bli denna med confirm byter användare och laddar om startsidan", () => {
    localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo" }));
    usersQuery.data = { users: [sampleUser] };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const replaceSpy = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
    render(<UsersPage />);
    fireEvent.click(screen.getByText("Bli denna"));
    expect(confirmSpy).toHaveBeenCalledWith("Logga in som Anna Karlsson?");
    expect(loadFirmaConfig()).toMatchObject({
      principalId: "u1", authorName: "Anna Karlsson", authorEmail: "anna@x.se",
    });
    expect(replaceSpy).toHaveBeenCalledWith("/");
    confirmSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("Bli denna med avbruten confirm byter inte användare", () => {
    localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo" }));
    usersQuery.data = { users: [sampleUser] };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const replaceSpy = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
    render(<UsersPage />);
    fireEvent.click(screen.getByText("Bli denna"));
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(loadFirmaConfig().principalId).toBeUndefined();
    confirmSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("när användaren inaktiverats laddas listan om", () => {
    render(<UsersPage />);
    deactivated?.();
    expect(listInvalidate).toHaveBeenCalled();
  });
});
