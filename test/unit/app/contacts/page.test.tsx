/**
 * Test för ContactsPage — listrendering, filter, +Ny kontakt-form.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import ContactsPage from "@/app/contacts/page";

const contactsQuery: {
  data: { contacts: Array<Record<string, unknown>>; total: number; pages: number };
  isLoading: boolean;
} = {
  data: { contacts: [], total: 0, pages: 0 },
  isLoading: false,
};
const utilsMock = { contacts: { list: { invalidate: vi.fn() } }, prefs: { get: { invalidate: vi.fn() } } };
const createMutate = vi.fn();
const searchParamsGet = vi.fn((_: string): string | null => null);

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: searchParamsGet }),
}));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    contacts: {
      list: { useQuery: () => contactsQuery },
      create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: {
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  contactsQuery.data = { contacts: [], total: 0, pages: 0 };
  searchParamsGet.mockReturnValue(null);
});

describe("ContactsPage", () => {
  it("renderar Kontakter-rubrik och +Ny kontakt-knapp", () => {
    render(<ContactsPage />);
    expect(screen.getAllByText(/Kontakter/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /\+ Ny kontakt/i })).toBeInTheDocument();
  });

  it("renderar kontakt i listan", () => {
    contactsQuery.data = {
      contacts: [
        {
          id: "c1",
          name: "Anna Andersson",
          contactType: "PERSON",
          personalNumber: "19850225-6655",
          orgNumber: null,
          email: "anna@x.se",
          phone: "070-123",
          _count: { matterLinks: 2, children: 0 },
        },
      ],
      total: 1,
      pages: 1,
    };
    render(<ContactsPage />);
    expect(screen.getByText("Anna Andersson")).toBeInTheDocument();
  });

  it("öppnar formulär vid +Ny kontakt", () => {
    render(<ContactsPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny kontakt/i }));
    // Form-submit-knappen "Skapa kontakt" syns nu
    expect(screen.getByRole("button", { name: /Skapa kontakt|Spara/i })).toBeInTheDocument();
  });

  it("öppnar form direkt med ?new=1 query-parameter", () => {
    searchParamsGet.mockImplementation((k: string) => (k === "new" ? "1" : null));
    render(<ContactsPage />);
    expect(screen.getByRole("button", { name: /Skapa kontakt|Spara/i })).toBeInTheDocument();
  });

  it("submittar nytt kontakt-formulär med namn", () => {
    render(<ContactsPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny kontakt/i }));
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(inputs[0]!, { target: { value: "Cecilia C" } });
    fireEvent.click(screen.getByRole("button", { name: /Spara kontakt/i }));
    expect(createMutate).toHaveBeenCalled();
    expect(createMutate.mock.calls[0]![0].name).toBe("Cecilia C");
  });

  it("byter mellan PERSON och COMPANY visar olika nummer-fält", () => {
    render(<ContactsPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny kontakt/i }));
    expect(screen.getByPlaceholderText(/YYYYMMDD/)).toBeInTheDocument();
    const typeSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "COMPANY" } });
    expect(screen.queryByPlaceholderText(/YYYYMMDD/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/XXXXXX-XXXX/)).toBeInTheDocument();
  });

  it("Avbryt-knappen i form stänger den", () => {
    render(<ContactsPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny kontakt/i }));
    expect(screen.getByRole("button", { name: /Spara kontakt/i })).toBeInTheDocument();
    // Det finns två "Avbryt" — top-headerns toggle och form Avbryt
    const cancelButtons = screen.getAllByRole("button", { name: /Avbryt/i });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    expect(screen.queryByRole("button", { name: /Spara kontakt/i })).not.toBeInTheDocument();
  });

  it("uppdaterar sökfältet och resettar page", () => {
    contactsQuery.data = {
      contacts: [],
      total: 0,
      pages: 0,
    };
    render(<ContactsPage />);
    const search = screen.getByPlaceholderText(/Sök kontakter/i) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "Anna" } });
    expect(search.value).toBe("Anna");
  });

  it("ändrar typ-filtret", () => {
    render(<ContactsPage />);
    const filters = screen.getAllByRole("combobox");
    const typeFilter = filters[filters.length - 1] as HTMLSelectElement;
    fireEvent.change(typeFilter, { target: { value: "COMPANY" } });
    expect(typeFilter.value).toBe("COMPANY");
  });

  it("visar paginering när pages > 1", () => {
    contactsQuery.data = {
      contacts: [],
      total: 50,
      pages: 3,
    };
    render(<ContactsPage />);
    expect(screen.getByText(/Sida 1 av 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nästa/i })).toBeInTheDocument();
  });

  it("paginering: Nästa ökar sidan", () => {
    contactsQuery.data = { contacts: [], total: 50, pages: 3 };
    render(<ContactsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Nästa/i }));
    expect(screen.getByText(/Sida 2 av 3/)).toBeInTheDocument();
  });

  it("paginering: Föregående är disabled på sida 1", () => {
    contactsQuery.data = { contacts: [], total: 50, pages: 3 };
    render(<ContactsPage />);
    const prev = screen.getByRole("button", { name: /Föregående/i }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it("uppdaterar alla formulärfält i ny kontakt-form", () => {
    render(<ContactsPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny kontakt/i }));
    const nameInput = screen.getByLabelText(/Namn/) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Bertil" } });
    expect(nameInput.value).toBe("Bertil");

    const personalNr = screen.getByLabelText(/Personnummer/) as HTMLInputElement;
    fireEvent.change(personalNr, { target: { value: "19800101-1234" } });
    expect(personalNr.value).toBe("19800101-1234");

    const email = screen.getByLabelText(/^E-post$/) as HTMLInputElement;
    fireEvent.change(email, { target: { value: "b@x.se" } });
    expect(email.value).toBe("b@x.se");

    const phone = screen.getByLabelText(/^Telefon$/) as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "070-1" } });
    expect(phone.value).toBe("070-1");

    const address = screen.getByLabelText(/^Adress$/) as HTMLInputElement;
    fireEvent.change(address, { target: { value: "Storgatan" } });
    expect(address.value).toBe("Storgatan");

    const notes = screen.getByLabelText(/Anteckningar/) as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "anteckning" } });
    expect(notes.value).toBe("anteckning");
  });

  it("uppdaterar org-nummerfält när typ=COMPANY", () => {
    render(<ContactsPage />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny kontakt/i }));
    const typeSelect = screen.getByLabelText(/^Typ$/) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "COMPANY" } });
    const orgNr = screen.getByLabelText(/Organisationsnummer/) as HTMLInputElement;
    fireEvent.change(orgNr, { target: { value: "556677-8899" } });
    expect(orgNr.value).toBe("556677-8899");
  });
});
