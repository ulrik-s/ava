/**
 * Test för ContactsSection (#27/#1136) — kontakt-panelen i ärendet: lista
 * (namn/roll/nummer), lägg till via sökdialog (befintlig eller ny kontakt,
 * med roll), ta bort.
 */

import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ContactsSection } from "@/app/matters/[id]/_contacts-section";
import { asId } from "@/lib/shared/schemas/ids";

vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

let searchHits: Array<{ id: string; name: string; contactType: string; personalNumber?: string | null }> = [];
const addContact = vi.fn();
const removeContact = vi.fn();
const createContact = vi.fn();
/** onSuccess från contacts.create — testet anropar den som servern hade gjort. */
let contactCreated: ((c: { id: string; name: string }) => void) | undefined;
const noopMut = () => ({ mutate: vi.fn(), isPending: false });

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      matter: { getById: { invalidate: vi.fn() } },
      contacts: { list: { invalidate: vi.fn() }, search: { invalidate: vi.fn() } },
    }),
    contacts: {
      search: { useQuery: (input: { term: string }) => ({ data: { contacts: input.term ? searchHits : [] }, isLoading: false }) },
      create: {
        useMutation: (o: { onSuccess: (c: { id: string; name: string }) => void }) => {
          contactCreated = o.onSuccess;
          return { mutate: createContact, isPending: false, error: null };
        },
      },
    },
    matter: {
      addContact: { useMutation: () => ({ mutate: addContact, isPending: false }) },
      removeContact: { useMutation: () => ({ mutate: removeContact, isPending: false }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: noopMut },
      clear: { useMutation: noopMut },
      setOrgDefault: { useMutation: noopMut },
      clearOrgDefault: { useMutation: noopMut },
    },
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
  },
}));

const contacts = [
  { id: "mc1", role: "KLIENT", contact: { id: "c1", name: "Klient Karlsson", personalNumber: "19800101-1234" } },
];

beforeEach(() => { vi.clearAllMocks(); searchHits = []; contactCreated = undefined; });

const openPicker = () => {
  render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} />);
  fireEvent.click(screen.getByText("+ Lägg till"));
  return screen.getByRole("dialog", { name: "Välj kontakt" });
};

describe("ContactsSection", () => {
  it("visar rubrik med antal + kontaktraderna (namn, roll, nummer)", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={contacts} />);
    expect(screen.getByText("Kontakter (1)")).toBeInTheDocument();
    expect(screen.getByText("Klient Karlsson")).toBeInTheDocument();
    expect(screen.getByText("19800101-1234")).toBeInTheDocument();
  });

  it("tomt → tomtillstånd", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} />);
    expect(screen.getByText("Kontakter (0)")).toBeInTheDocument();
    expect(screen.getByText("Inga kontakter kopplade")).toBeInTheDocument();
  });

  it("'+ Lägg till' öppnar sökdialogen — ingen dropdown med kontakter (#1136)", () => {
    const dialog = openPicker();
    expect(within(dialog).getByRole("searchbox")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Roll i ärendet")).toHaveValue("MOTPART");
    expect(within(dialog).getAllByRole("combobox")).toHaveLength(1); // bara rollen
  });

  it("sök + välj befintlig kontakt med vald roll → addContact, dialogen stängs", () => {
    searchHits = [{ id: "c2", name: "Berit Befintlig", contactType: "PERSON" }];
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByLabelText("Roll i ärendet"), { target: { value: "MOTPARTSOMBUD" } });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "berit" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Berit Befintlig/ }));
    expect(addContact).toHaveBeenCalledWith({ matterId: "m1", contactId: "c2", role: "MOTPARTSOMBUD" });
  });

  it("ingen träff → 'Ny kontakt…' förifylld; OK skapar och kopplar den till ärendet", () => {
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "Motpart AB" } });
    expect(screen.getByText(/Ingen träff — skapa kontakten/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ny kontakt/ }));
    const create = screen.getByRole("dialog", { name: "Ny kontakt" });
    expect((within(create).getByLabelText(/Namn/) as HTMLInputElement).value).toBe("Motpart AB");
    fireEvent.click(within(create).getByRole("button", { name: "OK" }));
    expect(createContact).toHaveBeenCalledWith(expect.objectContaining({ name: "Motpart AB" }));
    act(() => contactCreated?.({ id: "c-new", name: "Motpart AB" }));
    expect(addContact).toHaveBeenCalledWith({ matterId: "m1", contactId: "c-new", role: "MOTPART" });
  });

  it("Avbryt stänger dialogen utan att koppla något", () => {
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(addContact).not.toHaveBeenCalled();
  });

  it("Ta bort → removeContact.mutate med matterContactId", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={contacts} />);
    fireEvent.click(screen.getByText("Ta bort"));
    expect(removeContact).toHaveBeenCalledWith({ matterContactId: "mc1" });
  });
});
