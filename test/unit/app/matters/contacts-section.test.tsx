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
const invalidated = { matter: vi.fn(), watchlist: vi.fn() };
/** Ärendet (`matter.getById`): jävskontrollens fält styr posten under Parter (#1733). */
let matterData: Record<string, unknown> | undefined;
const checkConflicts = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      matter: { getById: { invalidate: invalidated.matter } },
      watchlist: { list: { invalidate: invalidated.watchlist } },
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
      addContact: {
        useMutation: (o: { onSuccess: () => void }) => ({ mutate: (a: unknown) => { addContact(a); o.onSuccess(); }, isPending: false }),
      },
      removeContact: { useMutation: () => ({ mutate: removeContact, isPending: false }) },
      getById: { useQuery: () => ({ data: matterData }) },
      checkConflicts: { useMutation: () => ({ mutate: checkConflicts, isPending: false }) },
      markConflictsReviewed: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: noopMut },
      clear: { useMutation: noopMut },
      setOrgDefault: { useMutation: noopMut },
      clearOrgDefault: { useMutation: noopMut },
    },
    user: {
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
      list: { useQuery: () => ({ data: { users: [{ id: "u1", name: "Anna Advokat" }] } }) },
    },
  },
}));

const contacts = [
  { id: "mc1", role: "KLIENT", contact: { id: "c1", name: "Klient Karlsson", personalNumber: "19800101-1234" } },
];

/** Ärendets titel — med blanksteg runt, som trimmas innan den hamnar i sökrutan. */
const TITLE = "  Skattetvist Exempel AB ";

beforeEach(() => { vi.clearAllMocks(); searchHits = []; contactCreated = undefined; matterData = undefined; });

const openPicker = () => {
  render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} matterTitle={TITLE} />);
  fireEvent.click(screen.getByText("+ Lägg till"));
  return screen.getByRole("dialog", { name: "Välj part" });
};

describe("ContactsSection", () => {
  it("visar rubrik med antal + kontaktraderna (namn, roll, nummer)", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={contacts} matterTitle={TITLE} />);
    expect(screen.getByText("Parter (1)")).toBeInTheDocument();
    expect(screen.getByText("Klient Karlsson")).toBeInTheDocument();
    expect(screen.getByText("19800101-1234")).toBeInTheDocument();
  });

  it("tomt → tomtillstånd", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={[]} matterTitle={TITLE} />);
    expect(screen.getByText("Parter (0)")).toBeInTheDocument();
    expect(screen.getByText("Inga parter kopplade")).toBeInTheDocument();
  });

  it("'+ Lägg till' öppnar sökdialogen — ingen dropdown med kontakter (#1136)", () => {
    const dialog = openPicker();
    expect(within(dialog).getByRole("searchbox")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Roll i ärendet")).toHaveValue("MOTPART");
    expect(within(dialog).getAllByRole("combobox")).toHaveLength(1); // bara rollen
  });

  it("dialogen säger \"part\": sökrutan och knappen för en ny (#1647)", () => {
    const dialog = openPicker();
    expect(within(dialog).getByLabelText("Sök part")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "+ Ny part…" })).toBeInTheDocument();
  });

  it("rollväljaren listar Medtilltalad (#1637)", () => {
    const dialog = openPicker();
    expect(within(within(dialog).getByLabelText("Roll i ärendet")).getByRole("option", { name: "Medtilltalad" }))
      .toHaveValue("MEDTILLTALAD");
  });

  it("sök + välj befintlig kontakt med vald roll → addContact, dialogen stängs", () => {
    searchHits = [{ id: "c2", name: "Berit Befintlig", contactType: "PERSON" }];
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByLabelText("Roll i ärendet"), { target: { value: "MOTPARTSOMBUD" } });
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "berit" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Berit Befintlig/ }));
    expect(addContact).toHaveBeenCalledWith({ matterId: "m1", contactId: "c2", role: "MOTPARTSOMBUD" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("en ny part uppdaterar ärendet och Frister — jävskontrollen kan ha ändrats (#1354)", () => {
    searchHits = [{ id: "c2", name: "Berit Befintlig", contactType: "PERSON" }];
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "berit" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Berit Befintlig/ }));
    expect(invalidated.matter).toHaveBeenCalledWith({ id: "m1" });
    expect(invalidated.watchlist).toHaveBeenCalled();
  });

  it("ingen träff → 'Ny part…' förifylld; OK skapar och kopplar den till ärendet", () => {
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "Motpart AB" } });
    expect(screen.getByText(/Ingen träff — skapa parten med "Ny part…"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ny part/ }));
    const create = screen.getByRole("dialog", { name: "Ny part" });
    expect((within(create).getByLabelText<HTMLInputElement>(/Namn/)).value).toBe("Motpart AB");
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

  describe("ärendets titel i sökrutan vid rollen Klient (#1645)", () => {
    const searchbox = (dialog: HTMLElement) => within(dialog).getByRole<HTMLInputElement>("searchbox");
    const chooseRole = (dialog: HTMLElement, role: string) =>
      fireEvent.change(within(dialog).getByLabelText("Roll i ärendet"), { target: { value: role } });

    it("standardrollen Motpart → tom sökruta", () => {
      expect(searchbox(openPicker()).value).toBe("");
    });

    it("byte till Klient med tom sökruta → den trimmade titeln fylls i", () => {
      const dialog = openPicker();
      chooseRole(dialog, "KLIENT");
      expect(searchbox(dialog).value).toBe("Skattetvist Exempel AB");
    });

    it("byte till Klient efter egen text → texten står kvar", () => {
      const dialog = openPicker();
      fireEvent.change(searchbox(dialog), { target: { value: "berit" } });
      chooseRole(dialog, "KLIENT");
      expect(searchbox(dialog).value).toBe("berit");
    });

    it("byte bort från Klient → titeln står kvar, inget rensas", () => {
      const dialog = openPicker();
      chooseRole(dialog, "KLIENT");
      chooseRole(dialog, "MOTPART");
      expect(searchbox(dialog).value).toBe("Skattetvist Exempel AB");
    });

    it("dialogen öppnas med rollen Klient → sökrutan har titeln", () => {
      const first = openPicker();
      chooseRole(first, "KLIENT");
      fireEvent.click(within(first).getByRole("button", { name: "Avbryt" }));
      fireEvent.click(screen.getByText("+ Lägg till"));
      const dialog = screen.getByRole("dialog", { name: "Välj part" });
      expect(within(dialog).getByLabelText("Roll i ärendet")).toHaveValue("KLIENT");
      expect(searchbox(dialog).value).toBe("Skattetvist Exempel AB");
    });

    it("tömd sökruta och byte till Klient igen → titeln fylls i på nytt", () => {
      const dialog = openPicker();
      chooseRole(dialog, "KLIENT");
      fireEvent.change(searchbox(dialog), { target: { value: "" } });
      chooseRole(dialog, "MOTPART");
      chooseRole(dialog, "KLIENT");
      expect(searchbox(dialog).value).toBe("Skattetvist Exempel AB");
    });
  });

  it("Ta bort → removeContact.mutate med matterContactId", () => {
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={contacts} matterTitle={TITLE} />);
    fireEvent.click(screen.getByText("Ta bort"));
    expect(removeContact).toHaveBeenCalledWith({ matterContactId: "mc1" });
  });

describe("jävskontrollen under Parter (#1733)", () => {
  const MATTER = { id: "m1", matterNumber: "2026-0001", status: "ACTIVE" };
  const renderSection = () =>
    render(<ContactsSection matterId={asId<"MatterId">("m1")} contacts={contacts} matterTitle={TITLE} />);

  it("träffar: visar 'N träffar att bedöma', Bedöm träffarna och Kör jävskontrollen igen", () => {
    matterData = { ...MATTER, conflictCheckStatus: "HITS", conflictCheckHits: 2 };
    renderSection();
    const group = screen.getByRole("group", { name: "Jävskontroll" });
    expect(within(group).getByText("Jävskontroll: 2 träffar att bedöma")).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Bedöm träffarna" })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "Kör jävskontrollen igen" }));
    expect(checkConflicts).toHaveBeenCalledWith({ id: "m1" });
  });

  it("kontrollen väntar: visar att den väntar, utan Bedöm träffarna", () => {
    matterData = { ...MATTER, conflictCheckStatus: "PENDING" };
    renderSection();
    const group = screen.getByRole("group", { name: "Jävskontroll" });
    expect(within(group).getByText("Jävskontroll väntar")).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "Bedöm träffarna" })).not.toBeInTheDocument();
  });

  it("klar utan träffar: ingen status", () => {
    matterData = { ...MATTER, conflictCheckStatus: "CLEAR", conflictCheckHits: 0 };
    renderSection();
    expect(screen.queryByRole("group", { name: "Jävskontroll" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Jävskontroll/)).not.toBeInTheDocument();
  });

  it("ärendet inte laddat: ingen status", () => {
    renderSection();
    expect(screen.queryByRole("group", { name: "Jävskontroll" })).not.toBeInTheDocument();
  });

  it("senaste bedömningen visas när den finns", () => {
    matterData = {
      ...MATTER, conflictCheckStatus: "REVIEWED", conflictReviewedById: "u1",
      conflictReviewedAt: "2026-10-01T12:05:00Z", conflictReviewNote: "Annan person, ingen konflikt.",
    };
    renderSection();
    const note = screen.getByRole("note", { name: "Jävskontrollens bedömning" });
    expect(within(note).getByText(/Jävskontrollen bedömd/)).toBeInTheDocument();
    expect(within(note).getByText("Annan person, ingen konflikt.")).toBeInTheDocument();
  });
});
});
