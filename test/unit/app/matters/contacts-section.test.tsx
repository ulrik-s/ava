/**
 * Test för ContactsSection (#27) — kontakt-panelen i ärendet: lista (namn/roll/
 * nummer), lägg-till-formulär (ny vs befintlig), skapa/koppla/ta-bort-mutationer.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { ContactsSection } from "@/app/matters/[id]/_contacts-section";
import { asId } from "@/lib/shared/schemas/ids";

vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const contactsListQuery = { data: { contacts: [{ id: "c2", name: "Berit Befintlig" }] }, isLoading: false };
const addContact = vi.fn();
const addNewContact = vi.fn();
const removeContact = vi.fn();
const noopMut = () => ({ mutate: vi.fn(), isPending: false });

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      matter: { getById: { invalidate: vi.fn() } },
      contacts: { list: { invalidate: vi.fn() } },
    }),
    contacts: { list: { useQuery: () => contactsListQuery } },
    matter: {
      addContact: { useMutation: () => ({ mutate: addContact, isPending: false }) },
      addNewContact: { useMutation: () => ({ mutate: addNewContact, isPending: false }) },
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

beforeEach(() => vi.clearAllMocks());

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

  it("'+ Lägg till' öppnar ny-kontakt-formuläret (default-läge)", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} />);
    fireEvent.click(screen.getByText("+ Lägg till"));
    expect(screen.getByPlaceholderText("Namn *")).toBeInTheDocument();
  });

  it("skapar ny kontakt → addNewContact.mutate med matterId + fält", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} />);
    fireEvent.click(screen.getByText("+ Lägg till"));
    fireEvent.change(screen.getByPlaceholderText("Namn *"), { target: { value: "Ny Person" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa & lägg till/ }));
    expect(addNewContact).toHaveBeenCalledWith(expect.objectContaining({ matterId: "m1", name: "Ny Person" }));
  });

  it("växlar till befintlig kontakt och kopplar → addContact.mutate", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} />);
    fireEvent.click(screen.getByText("+ Lägg till"));
    fireEvent.click(screen.getByText("Befintlig kontakt"));
    // Första comboboxen i befintlig-formuläret = kontakt-väljaren.
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lägg till$/ }));
    expect(addContact).toHaveBeenCalledWith(expect.objectContaining({ matterId: "m1", contactId: "c2" }));
  });

  it("Ta bort → removeContact.mutate med matterContactId", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={contacts} />);
    fireEvent.click(screen.getByText("Ta bort"));
    expect(removeContact).toHaveBeenCalledWith({ matterContactId: "mc1" });
  });

  it("ny ORGANISATION-kontakt: typ-byte → orgnummer-fältet + roll-select", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} />);
    fireEvent.click(screen.getByText("+ Lägg till"));
    fireEvent.change(screen.getByPlaceholderText("Namn *"), { target: { value: "Org AB" } });
    const [roleSel, typeSel] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const roleOpts = roleSel!.querySelectorAll("option");
    fireEvent.change(roleSel!, { target: { value: (roleOpts[1] as HTMLOptionElement).value } });
    const typeOpts = Array.from(typeSel!.querySelectorAll("option")) as HTMLOptionElement[];
    const nonPerson = typeOpts.find((o) => o.value !== "PERSON")!;
    fireEvent.change(typeSel!, { target: { value: nonPerson.value } });
    fireEvent.change(screen.getByPlaceholderText("Orgnummer"), { target: { value: "556677-8899" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa & lägg till/ }));
    expect(addNewContact).toHaveBeenCalledWith(
      expect.objectContaining({ matterId: "m1", name: "Org AB", orgNumber: "556677-8899" }),
    );
  });

  it("ny PERSON-kontakt: personnummer-fältet skrivs (PERSON-grenen)", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} />);
    fireEvent.click(screen.getByText("+ Lägg till"));
    fireEvent.change(screen.getByPlaceholderText("Namn *"), { target: { value: "Per Person" } });
    fireEvent.change(screen.getByPlaceholderText("Personnummer"), { target: { value: "19900101-1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa & lägg till/ }));
    expect(addNewContact).toHaveBeenCalledWith(
      expect.objectContaining({ personalNumber: "19900101-1234" }),
    );
  });

  it("befintlig-formuläret: roll-select exerceras + koppling", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} />);
    fireEvent.click(screen.getByText("+ Lägg till"));
    fireEvent.click(screen.getByText("Befintlig kontakt"));
    const [contactSel, roleSel] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const roleOpts = roleSel!.querySelectorAll("option");
    fireEvent.change(roleSel!, { target: { value: (roleOpts[1] as HTMLOptionElement).value } });
    fireEvent.change(contactSel!, { target: { value: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lägg till$/ }));
    expect(addContact).toHaveBeenCalledWith(expect.objectContaining({ matterId: "m1", contactId: "c2" }));
  });
});
