/**
 * Test för ContactDetailPage — visning, redigering, kontaktpersoner, ärenden.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import { Suspense } from "react";
import ContactDetailPage from "@/app/contacts/[id]/_client";

const routerPush = vi.fn();
const utilsMock = {
  contacts: {
    list: { invalidate: vi.fn() },
    getById: { invalidate: vi.fn() },
  },
};
const contactQuery = {
  data: undefined as null | Record<string, unknown> | undefined,
  isLoading: false,
  error: null as null | { message: string },
};
const updateMutate = vi.fn();
const updateState = { isPending: false };
const deleteMutate = vi.fn();
const deleteState = { isPending: false };
const addChildMutate = vi.fn();
const addChildState = { isPending: false };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  // useRouteId() läser usePathname; null → faller tillbaka till prop-id:t.
  usePathname: () => null,
  // useRouteId() läser även useSearchParams; tom → faller tillbaka till prop-id:t.
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    contacts: {
      getById: { useQuery: () => contactQuery },
      update: {
        useMutation: () => ({ mutate: updateMutate, isPending: updateState.isPending }),
      },
      delete: {
        useMutation: () => ({ mutate: deleteMutate, isPending: deleteState.isPending }),
      },
      addChild: {
        useMutation: () => ({ mutate: addChildMutate, isPending: addChildState.isPending }),
      },
    },
  },
}));

function renderPage() {
  return render(
    <Suspense fallback={<div>loading-suspense</div>}>
      <ContactDetailPage id="c1" />
    </Suspense>
  );
}

const personContact = {
  id: "c1",
  name: "Anna Andersson",
  contactType: "PERSON",
  personalNumber: "19850225-6655",
  orgNumber: null,
  email: "anna@x.se",
  phone: "070-1",
  address: "Storgatan 1",
  notes: "VIP",
  parent: null,
  children: [],
  matterLinks: [],
};

const orgContact = {
  id: "c2",
  name: "Acme AB",
  contactType: "FORETAG",
  personalNumber: null,
  orgNumber: "556677-8899",
  email: null,
  phone: null,
  address: null,
  notes: null,
  parent: null,
  children: [
    { id: "child1", name: "Bo Boman", email: "bo@acme.se", phone: "08-2", notes: "VD" },
  ],
  matterLinks: [
    {
      id: "ml1",
      role: "KLIENT",
      matter: { id: "m1", matterNumber: "2026-001", title: "Tvist", status: "ACTIVE" },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  contactQuery.data = personContact;
  contactQuery.isLoading = false;
  contactQuery.error = null;
  updateState.isPending = false;
  deleteState.isPending = false;
  addChildState.isPending = false;
});

describe("ContactDetailPage", () => {
  it("visar laddartext", async () => {
    contactQuery.isLoading = true;
    contactQuery.data = undefined;
    renderPage();
    expect(await screen.findByText(/Laddar/i)).toBeInTheDocument();
  });

  it("visar fel om query misslyckas", async () => {
    contactQuery.data = undefined;
    contactQuery.error = { message: "Nope" };
    renderPage();
    expect(await screen.findByText(/Nope/i)).toBeInTheDocument();
  });

  it("renderar persondetaljer", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Anna Andersson" })).toBeInTheDocument();
    expect(screen.getByText("anna@x.se")).toBeInTheDocument();
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText(/Inte kopplad till några ärenden/i)).toBeInTheDocument();
  });

  it("öppnar redigeringsformulär", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Anna Andersson" });
    fireEvent.click(screen.getByRole("button", { name: /Redigera/i }));
    expect(screen.getByDisplayValue("Anna Andersson")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Spara$/i })).toBeInTheDocument();
  });

  it("submit i editform anropar update", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Anna Andersson" });
    fireEvent.click(screen.getByRole("button", { name: /Redigera/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]![0]).toMatchObject({ id: "c1", name: "Anna Andersson" });
  });

  it("delete-knapp kallar delete efter confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByRole("heading", { name: "Anna Andersson" });
    fireEvent.click(screen.getByRole("button", { name: /^Ta bort$/i }));
    expect(deleteMutate).toHaveBeenCalledWith({ id: "c1" });
    confirmSpy.mockRestore();
  });

  it("visar kontaktpersoner och ärenden för organisation", async () => {
    contactQuery.data = orgContact;
    renderPage();
    expect(await screen.findByRole("heading", { name: "Acme AB" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Kontaktpersoner/i })).toBeInTheDocument();
    expect(screen.getByText("Bo Boman")).toBeInTheDocument();
    expect(screen.getByText(/2026-001/)).toBeInTheDocument();
    expect(screen.getByText(/Tvist/)).toBeInTheDocument();
  });

  it("öppnar formulär för att lägga till kontaktperson", async () => {
    contactQuery.data = orgContact;
    renderPage();
    await screen.findByRole("heading", { name: "Acme AB" });
    fireEvent.click(screen.getByRole("button", { name: /Lägg till/i }));
    fireEvent.change(screen.getByPlaceholderText(/Namn \*/), { target: { value: "Cecilia" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lägg till$/i }));
    expect(addChildMutate).toHaveBeenCalledTimes(1);
    expect(addChildMutate.mock.calls[0]![0]).toMatchObject({ parentId: "c1", name: "Cecilia" });
  });

  it("Avbryt vid redigering återgår till visningsläget", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Anna Andersson" });
    fireEvent.click(screen.getByRole("button", { name: /Redigera/i }));
    expect(screen.getByDisplayValue("Anna Andersson")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Avbryt/i }));
    expect(screen.queryByDisplayValue("Anna Andersson")).not.toBeInTheDocument();
  });

  it("ändrar e-post i edit-formulär och submittar", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Anna Andersson" });
    fireEvent.click(screen.getByRole("button", { name: /Redigera/i }));
    const emailInput = screen.getByDisplayValue("anna@x.se") as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "ny@x.se" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(updateMutate.mock.calls[0]![0].email).toBe("ny@x.se");
  });

  it("delete avbryts när confirm returnerar false", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await screen.findByRole("heading", { name: "Anna Andersson" });
    fireEvent.click(screen.getByRole("button", { name: /^Ta bort$/i }));
    expect(deleteMutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("renderar antal ärenden-badge för organisation", async () => {
    contactQuery.data = orgContact;
    renderPage();
    await screen.findByRole("heading", { name: "Acme AB" });
    expect(screen.getByText(/1 ärenden/)).toBeInTheDocument();
  });

  it("Avbryt i kontaktperson-formuläret stänger den", async () => {
    contactQuery.data = orgContact;
    renderPage();
    await screen.findByRole("heading", { name: "Acme AB" });
    const toggle = screen.getByRole("button", { name: /Lägg till/i });
    fireEvent.click(toggle);
    expect(screen.getByPlaceholderText(/Namn/)).toBeInTheDocument();
    // Toggle nu Avbryt
    fireEvent.click(screen.getByRole("button", { name: /^Avbryt$/i }));
    expect(screen.queryByPlaceholderText(/Namn \*/)).not.toBeInTheDocument();
  });

  it("uppdaterar alla edit-fält och submittar", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Anna Andersson" });
    fireEvent.click(screen.getByRole("button", { name: /Redigera/i }));
    fireEvent.change(screen.getByLabelText(/^Namn \*$/) as HTMLInputElement, { target: { value: "Annika" } });
    fireEvent.change(screen.getByLabelText(/^Typ$/) as HTMLSelectElement, { target: { value: "PERSON" } });
    fireEvent.change(screen.getByLabelText(/Personnummer/) as HTMLInputElement, { target: { value: "19900101-1111" } });
    fireEvent.change(screen.getByLabelText(/Organisationsnummer/) as HTMLInputElement, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Telefon/) as HTMLInputElement, { target: { value: "070-9" } });
    fireEvent.change(screen.getByLabelText(/^Adress$/) as HTMLInputElement, { target: { value: "Lillgatan" } });
    fireEvent.change(screen.getByLabelText(/Anteckningar/) as HTMLTextAreaElement, { target: { value: "ny" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    const arg = updateMutate.mock.calls[0]![0];
    expect(arg.name).toBe("Annika");
    expect(arg.phone).toBe("070-9");
    expect(arg.address).toBe("Lillgatan");
    expect(arg.notes).toBe("ny");
  });

  it("uppdaterar fälten för kontaktperson-formuläret", async () => {
    contactQuery.data = orgContact;
    renderPage();
    await screen.findByRole("heading", { name: "Acme AB" });
    fireEvent.click(screen.getByRole("button", { name: /Lägg till/i }));
    fireEvent.change(screen.getByPlaceholderText(/Namn \*/) as HTMLInputElement, { target: { value: "C" } });
    fireEvent.change(screen.getByPlaceholderText(/E-post/) as HTMLInputElement, { target: { value: "c@x.se" } });
    fireEvent.change(screen.getByPlaceholderText(/Telefon/) as HTMLInputElement, { target: { value: "07" } });
    fireEvent.change(screen.getByPlaceholderText(/Roll\/anteckning/) as HTMLInputElement, { target: { value: "VD" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lägg till$/i }));
    expect(addChildMutate).toHaveBeenCalled();
    expect(addChildMutate.mock.calls[0]![0]).toMatchObject({
      parentId: "c1", name: "C", email: "c@x.se", phone: "07", notes: "VD",
    });
  });

  it("renderar parent-länk när kontakten har en parent", async () => {
    contactQuery.data = { ...personContact, parent: { id: "p1", name: "Parent Org" } };
    renderPage();
    await screen.findByRole("heading", { name: "Anna Andersson" });
    expect(screen.getByRole("link", { name: /Parent Org/ })).toBeInTheDocument();
  });
});
