/**
 * Test för MatterDetailPage — den största sidan i appen.
 *
 * Mockar alla relaterade trpc-queries + mutations + barnkomponenter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MatterDetailPage from "@/app/matters/[id]/_client";

const matterQuery = {
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
  error: null as Error | null,
};
const timeQuery = {
  data: { entries: [], totalMinutes: 0 } as Record<string, unknown>,
};
const expenseQuery = {
  data: { expenses: [], totalAmount: 0 } as Record<string, unknown>,
};
const contactsQuery = { data: { contacts: [] } };
const templatesQuery = { data: undefined as undefined | Array<{ id: string; name: string; category: string | null; content?: string }>, isLoading: false };

const utilsMock = {
  matter: { getById: { invalidate: vi.fn() } },
  timeEntry: { list: { invalidate: vi.fn() } },
  expense: { list: { invalidate: vi.fn() } },
  contacts: { list: { invalidate: vi.fn() } },
  document: { tree: { invalidate: vi.fn() } },
  prefs: { get: { invalidate: vi.fn() } },
};
const stubs = {
  addContact: { mutate: vi.fn(), isPending: false },
  addNewContact: { mutate: vi.fn(), isPending: false },
  removeContact: { mutate: vi.fn(), isPending: false },
  createTimeEntry: { mutate: vi.fn(), isPending: false },
  createExpense: { mutate: vi.fn(), isPending: false },
  deleteExpense: { mutate: vi.fn(), isPending: false },
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    matter: {
      getById: { useQuery: () => matterQuery },
      addContact: { useMutation: () => stubs.addContact },
      addNewContact: { useMutation: () => stubs.addNewContact },
      removeContact: { useMutation: () => stubs.removeContact },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    timeEntry: {
      list: { useQuery: () => timeQuery },
      create: { useMutation: () => stubs.createTimeEntry },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    expense: {
      list: { useQuery: () => expenseQuery },
      create: { useMutation: () => stubs.createExpense },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => stubs.deleteExpense },
    },
    contacts: {
      list: { useQuery: () => contactsQuery },
    },
    documentTemplate: {
      list: { useQuery: () => templatesQuery },
    },
    document: {
      register: { useMutation: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }) },
      // useMatterInvariants (diagnostik) frågar dokument-listan för att
      // upptäcka KR-utan-dokument — måste finnas i mocken.
      list: { useQuery: () => ({ data: { documents: [] }, isLoading: false }) },
    },
    organization: {
      getSettings: { useQuery: () => ({ data: undefined }) },
    },
    kostnadsrakning: {
      record: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
    },
    billingRun: {
      list: { useQuery: () => ({ data: { runs: [] }, isLoading: false, refetch: vi.fn() }) },
      createAcconto: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createFinal: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createKostnadsrakning: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setVerdict: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    calendar: {
      listForMatter: { useQuery: () => ({ data: [] }) },
      listForUsers: { useQuery: () => ({ data: [] }) },
      list: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
    },
    user: {
      current: { useQuery: () => ({ data: { id: "u1", name: "Anna", email: "anna@firma.local" } }) },
      list: { useQuery: () => ({ data: { users: [] } }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

// Navigation: kalender-sektionen (tillagd denna session) använder
// useRouter/Link → måste mockas annars "app router not mounted".
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/matters/m1",
}));
vi.mock("@/lib/client/demo/use-route-id", () => ({ useRouteId: () => "m1" }));

// Tunga barnkomponenter — mocka som platshållare
vi.mock("@/components/documents/document-browser", () => ({
  DocumentBrowser: () => <div data-testid="doc-browser" />,
}));
vi.mock("@/components/matter/suggestions-panel", () => ({
  SuggestionsPanel: () => <div data-testid="suggestions" />,
}));
vi.mock("@/components/matter/events-panel", () => ({
  EventsPanel: () => <div data-testid="events" />,
}));
vi.mock("@/components/matter/invoices-section", () => ({
  InvoicesSection: () => <div data-testid="invoices" />,
}));
vi.mock("@/components/matter/payment-method-card", () => ({
  PaymentMethodCard: ({ paymentMethod }: { paymentMethod: string }) => (
    <div data-testid="pmc">{paymentMethod}</div>
  ),
}));

const M = {
  id: "m1",
  matterNumber: "2026-0001",
  title: "Bodelning Lindström",
  status: "ACTIVE",
  matterType: "Familjerätt",
  description: "En bodelning",
  paymentMethod: "RATTSHJALP",
  paymentMethodNote: null,
  paymentMethodDecidedAt: null,
  contacts: [
    {
      id: "mc1",
      role: "KLIENT",
      contact: { id: "c1", name: "Anna", contactType: "PERSON", personalNumber: null, orgNumber: null },
    },
  ],
  _count: { documents: 0, timeEntries: 0, emails: 0 },
};


const renderPage = () =>
  render(
    <Suspense fallback={<div>laddar</div>}>
      <MatterDetailPage id="m1" />
    </Suspense>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  matterQuery.data = M;
  matterQuery.isLoading = false;
  matterQuery.error = null;
  timeQuery.data = { entries: [], totalMinutes: 0 };
  expenseQuery.data = { expenses: [], totalAmount: 0 };
  templatesQuery.data = undefined;
  stubs.addContact.mutate = vi.fn();
  stubs.addNewContact.mutate = vi.fn();
  stubs.removeContact.mutate = vi.fn();
  stubs.createTimeEntry.mutate = vi.fn();
  stubs.createExpense.mutate = vi.fn();
  stubs.deleteExpense.mutate = vi.fn();
});

describe("MatterDetailPage", () => {
  it("visar laddartext under loading", async () => {
    matterQuery.isLoading = true;
    matterQuery.data = undefined;
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Laddar\.\.\./i)).toBeInTheDocument(),
    );
  });

  it("visar fel när matter.error är satt", async () => {
    matterQuery.error = new Error("Saknas");
    renderPage();
    await waitFor(() => expect(screen.getByText(/Saknas/)).toBeInTheDocument());
  });

  it("renderar matterNumber + title + klient-länk", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("2026-0001")).toBeInTheDocument());
    expect(screen.getByText("Bodelning Lindström")).toBeInTheDocument();
    // "Anna" finns flera ställen — minst en är klient-länken
    expect(screen.getAllByRole("link", { name: "Anna" }).length).toBeGreaterThan(0);
  });

  it("renderar PaymentMethodCard med paymentMethod", async () => {
    renderPage();
    await waitFor(() => {
      const pmc = screen.getByTestId("pmc");
      expect(pmc).toHaveTextContent("RATTSHJALP");
    });
  });

  it("renderar mockade barnkomponenter", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("doc-browser")).toBeInTheDocument());
    expect(screen.getByTestId("suggestions")).toBeInTheDocument();
    expect(screen.getByTestId("events")).toBeInTheDocument();
    // 'invoices'-panelen är borttagen — BillingPanel ersätter den
  });

  it("visar Aktivt-badge när status=ACTIVE", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Aktivt")).toBeInTheDocument());
  });

  it("visar Stängt-badge när status=CLOSED", async () => {
    matterQuery.data = { ...M, status: "CLOSED" };
    renderPage();
    await waitFor(() => expect(screen.getByText("Stängt")).toBeInTheDocument());
  });

  it("öppnar Generera dokument-modal", async () => {
    renderPage();
    const button = await waitFor(() =>
      screen.getByRole("button", { name: /Generera dokument/i }),
    );
    fireEvent.click(button);
    expect(screen.getByText(/Välj mall/i)).toBeInTheDocument();
  });

  it("visar tidregistrering-totalt", async () => {
    timeQuery.data = { entries: [], totalMinutes: 90 };
    renderPage();
    await waitFor(() => expect(screen.getByText(/1:30/)).toBeInTheDocument());
  });

  // Regression: när time-entry-listans `user`-join returnerar null (t.ex. mot
  // git-db där en användare raderats) får tabellen INTE krascha med
  // "Cannot read properties of null (reading 'name')".
  it("renderar tidsrad även om entry.user är null", async () => {
    timeQuery.data = {
      entries: [
        { id: "t1", date: "2026-01-15", minutes: 60, description: "Möte", billable: true, user: null },
      ],
      totalMinutes: 60,
    };
    renderPage();
    await waitFor(() => expect(screen.getByText("Möte")).toBeInTheDocument());
    // Fallback-texten visas i Advokat-kolumnen (kan finnas fler "—" i andra kolumner)
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("visar Arkiverat-badge för andra statusar", async () => {
    matterQuery.data = { ...M, status: "ARCHIVED" };
    renderPage();
    await waitFor(() => expect(screen.getByText("Arkiverat")).toBeInTheDocument());
  });

  it("renderar matterType + description", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Familjerätt/)).toBeInTheDocument());
    expect(screen.getByText("En bodelning")).toBeInTheDocument();
  });

  it("öppnar och stänger lägg-till-kontakt-formuläret", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("2026-0001")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\+ Lägg till/i }));
    expect(screen.getByPlaceholderText(/Namn/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Avbryt/i }));
    expect(screen.queryByPlaceholderText(/Namn/i)).not.toBeInTheDocument();
  });

  it("växlar mellan Befintlig och Ny kontakt-läget", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Lägg till/i }));
    fireEvent.click(screen.getByRole("button", { name: /Befintlig kontakt/i }));
    expect(screen.getByText(/Välj kontakt/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Ny kontakt$/i }));
    expect(screen.getByPlaceholderText(/Namn/i)).toBeInTheDocument();
  });

  it("submittar Ny kontakt-formuläret", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Lägg till/i }));
    const nameInput = screen.getByPlaceholderText(/Namn/i);
    fireEvent.change(nameInput, { target: { value: "Bertil Berg" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa & lägg till/i }));
    expect(stubs.addNewContact.mutate).toHaveBeenCalled();
    const arg = stubs.addNewContact.mutate.mock.calls[0]![0];
    expect(arg.name).toBe("Bertil Berg");
    expect(arg.matterId).toBe("m1");
  });

  it("klickar Ta bort på en kontakt", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    const removeButtons = screen.getAllByRole("button", { name: /^Ta bort$/i });
    fireEvent.click(removeButtons[0]!);
    expect(stubs.removeContact.mutate).toHaveBeenCalledWith({ matterContactId: "mc1" });
  });

  it("öppnar tidsformulär och submittar", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    const desc = screen.getByPlaceholderText(/Beskrivning/i);
    fireEvent.change(desc, { target: { value: "Mejl och telefon" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(stubs.createTimeEntry.mutate).toHaveBeenCalled();
    const arg = stubs.createTimeEntry.mutate.mock.calls[0]![0];
    expect(arg.matterId).toBe("m1");
    expect(arg.description).toBe("Mejl och telefon");
    expect(arg.billable).toBe(true);
  });

  it("togglar debiterbar-checkbox i tidsformulär", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    const checkbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("öppnar utläggsformulär och submittar", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt utlägg/i }));
    const desc = screen.getByPlaceholderText(/Beskrivning/i);
    fireEvent.change(desc, { target: { value: "Domstolsavgift" } });
    const numberInput = screen.getByPlaceholderText(/0,00/);
    fireEvent.change(numberInput, { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    expect(stubs.createExpense.mutate).toHaveBeenCalled();
    const arg = stubs.createExpense.mutate.mock.calls[0]![0];
    expect(arg.amount).toBe(15000); // SEK → öre
    expect(arg.description).toBe("Domstolsavgift");
  });

  it("renderar tidsposter i tabellen", async () => {
    timeQuery.data = {
      entries: [
        {
          id: "te1",
          date: new Date("2026-04-01"),
          minutes: 60,
          description: "Telefonsamtal",
          billable: true,
          user: { name: "Lisa Lawyer" },
        },
      ],
      totalMinutes: 60,
    };
    renderPage();
    await waitFor(() => expect(screen.getByText("Telefonsamtal")).toBeInTheDocument());
    expect(screen.getByText("Lisa Lawyer")).toBeInTheDocument();
  });

  it("renderar utlägg och tar bort vid klick", async () => {
    expenseQuery.data = {
      expenses: [
        {
          id: "e1",
          date: new Date("2026-04-01"),
          amount: 15000,
          description: "Domstolsavgift",
          billable: true,
          user: { name: "Lisa" },
        },
      ],
      totalAmount: 15000,
    };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true); // delete bakom confirm nu
    renderPage();
    await waitFor(() => expect(screen.getByText("Domstolsavgift")).toBeInTheDocument());
    const removes = screen.getAllByRole("button", { name: /^Ta bort$/i });
    // sista Ta bort-knappen är på utläggsraden
    fireEvent.click(removes[removes.length - 1]!);
    expect(stubs.deleteExpense.mutate).toHaveBeenCalledWith({ id: "e1" });
    confirmSpy.mockRestore();
  });

  it("byter format till HTML-fil i generera-modal", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    // Format-alternativen är nu "PDF (via utskrift)" / "HTML-fil" (värde docx).
    const htmlRadio = screen.getByRole("radio", { name: /HTML/i }) as HTMLInputElement;
    fireEvent.click(htmlRadio);
    expect(htmlRadio.checked).toBe(true);
  });

  it("kryssar i mottagare i generera-modal", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    // Mottagar-checkboxen för Anna
    const allChecks = screen.getAllByRole("checkbox");
    const annaCheck = allChecks.find((c) =>
      (c as HTMLInputElement).closest("label")?.textContent?.includes("Anna"),
    ) as HTMLInputElement | undefined;
    expect(annaCheck).toBeTruthy();
    fireEvent.click(annaCheck!);
    expect(annaCheck!.checked).toBe(true);
    // Räknaren ska visa 1
    expect(screen.getByText(/Mottagare \(1\)/i)).toBeInTheDocument();
  });

  it("listar mallar i selectern och tillåter val", async () => {
    templatesQuery.data = [
      { id: "tpl1", name: "Stämning", category: "Avtal" },
      { id: "tpl2", name: "Fullmakt", category: null },
    ];
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    expect(screen.getByText(/Avtal – Stämning/)).toBeInTheDocument();
    expect(screen.getByText(/Fullmakt/)).toBeInTheDocument();
  });

  it("visar Skapa en mall-länk när inga mallar finns", async () => {
    templatesQuery.data = [];
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    expect(screen.getByRole("link", { name: /Skapa en mall/i })).toBeInTheDocument();
  });

  it("stänger generera-modal med Avbryt", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    expect(screen.getByText(/Välj mall/i)).toBeInTheDocument();
    const avbrytButtons = screen.getAllByRole("button", { name: /Avbryt/i });
    fireEvent.click(avbrytButtons[avbrytButtons.length - 1]!);
    expect(screen.queryByText(/Välj mall/i)).not.toBeInTheDocument();
  });

  it("submittar 'befintlig kontakt'-formuläret", async () => {
    contactsQuery.data = { contacts: [{ id: "c2", name: "Bertil" }] } as never;
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Lägg till/i }));
    fireEvent.click(screen.getByRole("button", { name: /Befintlig kontakt/i }));
    const select = screen.getByText(/Välj kontakt/i).closest("select")!;
    fireEvent.change(select, { target: { value: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lägg till$/i }));
    expect(stubs.addContact.mutate).toHaveBeenCalled();
    const arg = stubs.addContact.mutate.mock.calls[0]![0];
    expect(arg.contactId).toBe("c2");
    expect(arg.matterId).toBe("m1");
  });

  it("genererar dokument client-side (öppnar blob i ny flik)", async () => {
    // Ny flöde: renderHandlebars i browsern → window.open(blob), ingen /api-fetch.
    templatesQuery.data = [{ id: "tpl1", name: "Stämning", category: null, content: "<p>{{matter.matterNumber}}</p>" }];
    const openMock = vi.fn();
    Object.defineProperty(window, "open", { value: openMock, writable: true, configurable: true });
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:fake"), writable: true, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true, configurable: true });
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "tpl1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generera$/i }));
    await waitFor(() => expect(openMock).toHaveBeenCalledWith("blob:fake", "_blank", "noopener,noreferrer"));
  });

  it("visar fel när mallen saknar innehåll", async () => {
    templatesQuery.data = [{ id: "tpl1", name: "Stämning", category: null }]; // ingen content
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "tpl1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generera$/i }));
    await waitFor(() => expect(screen.getByText(/Mallen saknar innehåll/)).toBeInTheDocument());
  });
});
