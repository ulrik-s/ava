/**
 * Test för InvoiceDetailPage — fakturalisning, betalningar, plan, kreditera.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Suspense } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import InvoiceDetailPage from "@/app/invoices/[id]/_client";
import { VatDisplayProvider } from "@/lib/client/vat/vat-display-context";
import { rowOrder, sortColumn } from "../../../../helpers/data-table";

const invoiceQuery = {
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
  error: null as Error | null,
};

const utilsMock = {
  // Faktureringshändelser loggas som anteckning och kan lösa en bevakning (#1221).
  serviceNote: { list: { invalidate: vi.fn(async () => {}) } },
  watchlist: { list: { invalidate: vi.fn(async () => {}) } },
  invoice: {
    getById: { invalidate: vi.fn() },
    list: { invalidate: vi.fn() },
  },
  // Utskickshistoriken laddas om efter ett utskick (#392).
  invoiceDispatch: { list: { invalidate: vi.fn() } },
  // Fakturadokumentet hämtas från servern via tRPC-klienten (#518).
  client: { document: { downloadContent: { query: vi.fn() } } },
};
let setStatusOpts: { onSuccess: () => void } | undefined;
/** En mutationsstubbe; `mutateAsync` används av "Fel på fakturan?"-dialogen (#2260). */
const stub = () => ({ mutate: vi.fn(), mutateAsync: vi.fn((_input: unknown) => Promise.resolve()), isPending: false });
const stubs = {
  recordPayment: stub(),
  createPaymentPlan: stub(),
  cancelPaymentPlan: stub(),
  setStatus: stub(),
  voidDraft: stub(),
  creditAndRedo: stub(),
  writeOff: stub(),
};
/** Navigeringen efter "Kreditera och gör om" (#2260). */
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }), usePathname: () => null, useSearchParams: () => null }));

/** Callbacks som sidan ger useMutation — testerna spelar upp serverns svar genom dem. */
interface MutationOpts { onSuccess?: () => void; onError?: (e: Error) => void }
type StubKey = keyof typeof stubs;
const mutationOpts: Partial<Record<StubKey, MutationOpts>> = {};
const captured = (key: StubKey, o: MutationOpts) => { mutationOpts[key] = o; return stubs[key]; };

/** Låt mutationen svara som servern: lyckas, eller fel med `error` som meddelande. */
function respond(key: StubKey, error?: string): void {
  const run = () => {
    const o = mutationOpts[key];
    if (error) o?.onError?.(new Error(error));
    else o?.onSuccess?.();
  };
  stubs[key].mutate = vi.fn(run);
  stubs[key].mutateAsync = vi.fn((_input: unknown) => { run(); return error ? Promise.reject(new Error(error)) : Promise.resolve(); });
}

// Dockytan (#1184) kräver en riktig webbläsarlayout — här renderas huvudet och
// alla paneler efter varandra, synkront, så testerna kan granska innehållet.
vi.mock("@/components/layout/panel-page", () => ({
  PanelPage: ({ header, panels }: { header: React.ReactNode; panels: ReadonlyArray<{ id: string; render: () => React.ReactNode }> }) => (
    <>{header}{panels.map((p) => <div key={p.id} data-panel={p.id}>{p.render()}</div>)}</>
  ),
}));

/** Byråns användare (`user.list`): prefixen styr initialerna i länken till ärendet (#1728). */
const usersQuery: { data: { users: Array<{ id: string; name: string; matterNumberPrefix?: string | null }> } } = {
  data: { users: [] },
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    // DataTable (#1146) läser/sparar vy-inställningar.
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: {
      list: { useQuery: () => usersQuery },
      current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) },
    },
    useUtils: () => utilsMock,
    invoice: {
      getById: { useQuery: () => invoiceQuery },
      recordPayment: { useMutation: (o: MutationOpts) => captured("recordPayment", o) },
      createPaymentPlan: { useMutation: (o: MutationOpts) => captured("createPaymentPlan", o) },
      cancelPaymentPlan: { useMutation: () => stubs.cancelPaymentPlan },
      setStatus: { useMutation: (o: { onSuccess: () => void }) => { setStatusOpts = o; return stubs.setStatus; } },
      voidDraft: { useMutation: (o: MutationOpts) => captured("voidDraft", o) },
      creditAndRedo: { useMutation: (o: MutationOpts) => captured("creditAndRedo", o) },
      writeOff: { useMutation: (o: MutationOpts) => captured("writeOff", o) },
    },
    invoiceDispatch: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      // Utskicksmodalen (#392): köningen lyckas direkt.
      queue: { useMutation: (o: MutationOpts) => ({ mutate: () => o.onSuccess?.(), isPending: false }) },
      recordManual: { useMutation: (o: MutationOpts) => ({ mutate: () => o.onSuccess?.(), isPending: false }) },
    },
  },
}));

// Fortnox-bokföring (#1172): ingen integration i de här testerna.
vi.mock("@/lib/client/backend/server-ledger", () => ({
  useLedgerStatus: () => ({ data: undefined }),
  useBookInvoice: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

// Fakturadokument-panelen ska ÖPPNA dokumentet (ny flik) via openDocument —
// INTE navigera in i ärendet. Mocka open-document-flödet för att verifiera.
const openDocumentMock = vi.fn();
vi.mock("@/lib/client/firma/open-document", () => ({
  openDocument: (deps: unknown) => openDocumentMock(deps),
}));
const loadHandleMock = vi.fn(async (_key: string) => null);
vi.mock("@/lib/client/fsa/handle-store", () => ({ loadHandle: (key: string) => loadHandleMock(key) }));
const loadDocumentBlobMock = vi.fn((_client: unknown, _doc: unknown) => Promise.resolve(null));
vi.mock("@/lib/client/backend/load-document-blob", () => ({
  loadDocumentBlob: (client: unknown, doc: unknown) => loadDocumentBlobMock(client, doc),
}));
// Utskicksmodalen probar annars den riktiga AVA Helper (#1368).
vi.mock("@/lib/client/helper/use-helper", () => ({
  useHelper: () => ({ version: null, checked: true }),
  composeMailViaHelper: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("@/lib/client/fsa/read-from-fsa", () => ({ readFromFsa: vi.fn(async () => null) }));

const renderPage = () =>
  render(
    <Suspense fallback={<div>laddar</div>}>
      <InvoiceDetailPage id="i1" />
    </Suspense>,
  );

const baseInvoice = {
  id: "i1",
  invoiceType: "STANDARD",
  status: "SENT",
  amount: 1000000, // 10 000 kr
  invoiceDate: new Date("2026-04-01"),
  dueDate: new Date("2026-05-01"),
  notes: null,
  matter: { id: "m1", matterNumber: "2026-0001", title: "X" },
  payments: [],
  paymentPlan: null,
  accontoDeductions: [],
  deductedOnFinals: [],
  creditedInvoice: null,
  creditNote: null,
  timeEntries: [],
  expenses: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  invoiceQuery.data = baseInvoice;
  usersQuery.data.users = [];
  invoiceQuery.isLoading = false;
  invoiceQuery.error = null;
  stubs.recordPayment.mutate = vi.fn();
  stubs.createPaymentPlan.mutate = vi.fn();
  stubs.cancelPaymentPlan.mutate = vi.fn();
  stubs.setStatus.mutate = vi.fn();
  stubs.voidDraft.mutateAsync = vi.fn((_input: unknown) => Promise.resolve());
  stubs.creditAndRedo.mutateAsync = vi.fn((_input: unknown) => Promise.resolve());
  stubs.writeOff.mutate = vi.fn();
});

describe("InvoiceDetailPage", () => {
  it("visar laddartext under loading", async () => {
    invoiceQuery.isLoading = true;
    invoiceQuery.data = undefined;
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Laddar/i)).toBeInTheDocument(),
    );
  });

  it("visar fel när data saknas", async () => {
    invoiceQuery.data = undefined;
    invoiceQuery.error = new Error("not found");
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Kunde inte ladda/i)).toBeInTheDocument(),
    );
  });

  it("renderar Faktura-rubrik och status Skickad", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Faktura/i })).toBeInTheDocument(),
    );
    expect(screen.getByText("Skickad")).toBeInTheDocument();
  });

  it("länken tillbaka till ärendet visar ansvarig jurists initialer framför numret (#1728)", async () => {
    usersQuery.data.users = [{ id: "u-cd", name: "Cecilia D", matterNumberPrefix: "CD" }];
    invoiceQuery.data = { ...baseInvoice, matter: { id: "m1", matterNumber: "2026-0001", title: "X", responsibleLawyerId: "u-cd" } };
    renderPage();
    const link = await screen.findByRole("link", { name: "← CD 2026-0001 X" });
    expect(within(link).getByText("CD").tagName).toBe("STRONG");
  });

  it("beloppsrubriken följer momsväxlingen: inkl. → exkl. efter klick (#1726)", async () => {
    window.localStorage.clear();
    render(<VatDisplayProvider><Suspense fallback={<div>laddar</div>}><InvoiceDetailPage id="i1" /></Suspense></VatDisplayProvider>);
    await waitFor(() => expect(screen.getByText("Belopp inkl. moms")).toBeInTheDocument());
    expect(screen.queryByText("Belopp (brutto)")).toBeNull();
    const amountBtn = screen.getByText("Belopp inkl. moms").nextElementSibling?.querySelector("button");
    if (!amountBtn) throw new Error("beloppsknappen saknas");
    fireEvent.click(amountBtn);
    expect(screen.getByText("Belopp exkl. moms")).toBeInTheDocument();
    expect(screen.queryByText("Belopp inkl. moms")).toBeNull();
    window.localStorage.clear();
  });

  it("renderar Acconto-rubrik för ACCONTO-typ", async () => {
    invoiceQuery.data = { ...baseInvoice, invoiceType: "ACCONTO" };
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Aconto-faktura/i })).toBeInTheDocument(),
    );
  });

  it("renderar Kreditfaktura-rubrik för CREDIT-typ", async () => {
    invoiceQuery.data = {
      ...baseInvoice,
      invoiceType: "CREDIT",
      amount: -500000,
      creditedInvoice: {
        id: "i0",
        invoiceDate: new Date("2026-03-01"),
        amount: 500000,
        invoiceType: "STANDARD",
      },
    };
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Kreditfaktura/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/Detta är en kreditfaktura/i)).toBeInTheDocument();
  });

  it("visar Fel på fakturan? på en SENT-faktura — inga Annullera/Kreditera-knappar (#2260)", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Fel på fakturan\?/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /^Annullera$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Kreditera$/i })).not.toBeInTheDocument();
  });

  it("visar 'krediterad'-banner när creditNote finns", async () => {
    invoiceQuery.data = {
      ...baseInvoice,
      creditNote: {
        id: "c1",
        invoiceDate: new Date("2026-04-15"),
        amount: -1000000,
      },
    };
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Denna faktura är krediterad/i)).toBeInTheDocument(),
    );
  });

  it("öppnar Registrera betalning-modal", async () => {
    renderPage();
    const btn = await waitFor(() =>
      screen.getByRole("button", { name: /Registrera betalning/i }),
    );
    fireEvent.click(btn);
    expect(screen.getByRole("heading", { name: /Registrera betalning/i })).toBeInTheDocument();
  });

  it("öppnar Skapa avbetalningsplan-modal när plan saknas", async () => {
    renderPage();
    const btn = await waitFor(() =>
      screen.getByRole("button", { name: /Skapa avbetalningsplan/i }),
    );
    fireEvent.click(btn);
    expect(screen.getByRole("heading", { name: /Skapa avbetalningsplan/i })).toBeInTheDocument();
  });

  it("submittar betalning med belopp i öre", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Registrera betalning/i })),
    );
    fireEvent.change(screen.getByLabelText("Belopp (kr)"), { target: { value: "5000" } });
    const sparaBtns = screen.getAllByRole("button", { name: /^Spara$/i });
    fireEvent.click(sparaBtns[sparaBtns.length - 1]!);
    expect(stubs.recordPayment.mutate).toHaveBeenCalled();
    expect(stubs.recordPayment.mutate.mock.calls[0]![0]).toMatchObject({
      invoiceId: "i1",
      amount: 500000,
    });
  });

  it("Avbryt stänger betalningsmodalen", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Registrera betalning/i })),
    );
    const cancels = screen.getAllByRole("button", { name: /Avbryt/i });
    fireEvent.click(cancels[0]!);
    expect(screen.queryByRole("heading", { name: /Registrera betalning/i })).not.toBeInTheDocument();
  });

  it("submittar avbetalningsplan med månadsbelopp och dag", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Skapa avbetalningsplan/i })),
    );
    fireEvent.change(screen.getByLabelText("Månadsbelopp (kr)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa plan/i }));
    expect(stubs.createPaymentPlan.mutate).toHaveBeenCalled();
    expect(stubs.createPaymentPlan.mutate.mock.calls[0]![0]).toMatchObject({
      invoiceId: "i1",
      monthlyAmount: 100000,
    });
  });

  it("Skapa plan-knappen är disabled tills månadsbelopp anges", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Skapa avbetalningsplan/i })),
    );
    const skapaBtn = screen.getByRole<HTMLButtonElement>("button", { name: /Skapa plan/i });
    expect(skapaBtn.disabled).toBe(true);
  });

  it("Kreditera och gör om: anledningen skickas och faktureringen öppnas för ärendet (#2260)", async () => {
    invoiceQuery.data = { ...baseInvoice, invoiceNumber: "F-2026-0007", matterId: "m1", invoiceType: "FINAL" };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Fel på fakturan\?/i }));
    expect(screen.getByText(/kan inte ändras eller makuleras/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText<HTMLTextAreaElement>(/fel timpris/i), { target: { value: "Felaktig fakturering" } });
    fireEvent.click(screen.getByRole("button", { name: "Kreditera faktura F-2026-0007 och gör om" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/matters/__shell__/?id=m1&fakturera=FINAL"));
    expect(stubs.creditAndRedo.mutateAsync).toHaveBeenCalledWith({ invoiceId: "i1", notes: "Felaktig fakturering" });
  });

  it("Makulera ett utkast: dialogen förklarar och makulerar, utan navigering (#2260)", async () => {
    invoiceQuery.data = { ...baseInvoice, status: "DRAFT", invoiceNumber: "F-2026-0008", matterId: "m1" };
    respond("voidDraft");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Fel på fakturan\?/i }));
    expect(screen.getByText(/som inte används igen/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Makulera faktura F-2026-0008" }));
    await waitFor(() => expect(stubs.voidDraft.mutateAsync).toHaveBeenCalledWith({ invoiceId: "i1" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("en betald faktura: dialogen förklarar varför den inte görs om och erbjuder ingen åtgärd (#2260)", async () => {
    invoiceQuery.data = { ...baseInvoice, status: "PAID", payments: [{ id: "p1", amount: 1000000, paidAt: new Date("2026-04-10"), note: null, recordedBy: null }] };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Fel på fakturan\?/i }));
    expect(screen.getByText(/tillgodohavande/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kreditera faktura|Makulera faktura/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Kreditera och gör om som servern nekar: felet visas, ingen navigering", async () => {
    respond("creditAndRedo", "Servern nekade");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Fel på fakturan\?/i }));
    fireEvent.click(lastButton(/och gör om/));
    await waitFor(() => expect(screen.getByText("Servern nekade")).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("efter statusändring hämtas ärendets Anteckningar och Frister om (#1221)", async () => {
    invoiceQuery.data = { ...baseInvoice, status: "DRAFT" };
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /Markera som skickad/i }));
    setStatusOpts?.onSuccess();
    expect(utilsMock.serviceNote.list.invalidate).toHaveBeenCalled();
    expect(utilsMock.watchlist.list.invalidate).toHaveBeenCalled();
  });

  it("Skriv av som kundförlust öppnar modal → writeOff-mutationen (ADR 0007)", async () => {
    renderPage();
    const open = await waitFor(() =>
      screen.getByRole("button", { name: /Skriv av som kundförlust/i }),
    );
    fireEvent.click(open);
    // Modalens submit-knapp heter "Skriv av"; default-belopp = hela utestående.
    const submit = await waitFor(() => screen.getByRole("button", { name: "Skriv av" }));
    fireEvent.click(submit);
    expect(stubs.writeOff.mutate).toHaveBeenCalled();
    expect(stubs.writeOff.mutate.mock.calls[0]![0]).toMatchObject({ invoiceId: "i1", amount: 1000000 });
    expect(stubs.setStatus.mutate).not.toHaveBeenCalledWith(expect.objectContaining({ status: "BAD_DEBT" }));
  });

  it("DRAFT-faktura visar Markera som skickad", async () => {
    invoiceQuery.data = { ...baseInvoice, status: "DRAFT" };
    renderPage();
    const btn = await waitFor(() =>
      screen.getByRole("button", { name: /Markera som skickad/i }),
    );
    fireEvent.click(btn);
    expect(stubs.setStatus.mutate).toHaveBeenCalledWith({
      invoiceId: "i1",
      status: "SENT",
    });
  });

  it("renderar betalningar i tabellen och totalt", async () => {
    invoiceQuery.data = {
      ...baseInvoice,
      payments: [
        {
          id: "p1",
          amount: 250000,
          paidAt: new Date("2026-04-15"),
          note: "Bankgiro",
          recordedBy: { name: "Ada" },
        },
      ],
    };
    renderPage();
    await waitFor(() => expect(screen.getByText("Bankgiro")).toBeInTheDocument());
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText(/Totalt betalat/i)).toBeInTheDocument();
  });

  it("Avbryt planen anropar cancelPlan", async () => {
    invoiceQuery.data = {
      ...baseInvoice,
      paymentPlan: {
        id: "pp1",
        monthlyAmount: 100000,
        dayOfMonth: 5,
        startDate: new Date("2026-04-01"),
        status: "ACTIVE",
        notes: "Notering",
        reminders: [],
      },
    };
    renderPage();
    const btn = await waitFor(() =>
      screen.getByRole("button", { name: /Avbryt planen/i }),
    );
    fireEvent.click(btn);
    expect(stubs.cancelPaymentPlan.mutate).toHaveBeenCalledWith({ planId: "pp1" });
  });

  it("renderar accontoavdrag på FINAL-faktura", async () => {
    invoiceQuery.data = {
      ...baseInvoice,
      invoiceType: "FINAL",
      accontoDeductions: [
        {
          id: "ad1",
          accontoInvoice: {
            id: "ai1",
            invoiceDate: new Date("2026-03-01"),
            amount: 200000,
          },
        },
      ],
    };
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Acontoavdrag/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/Aconto 2026-03-01/)).toBeInTheDocument();
  });

  it("underlaget räknas som fakturan avrundades: hela kronor på nya, öre på äldre (#1438)", async () => {
    const entries = { timeEntries: [{ id: "t1", date: new Date("2026-03-01"), description: "Brev", minutes: 7, hourlyRate: 100_000 }],
      expenses: [{ id: "e1", date: new Date("2026-03-02"), description: "Porto", amount: 4_999, vatRate: 0, vatIncluded: false }] };
    invoiceQuery.data = { ...baseInvoice, invoiceType: "FINAL", amountRounding: "KRONOR", ...entries };
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Underlag/i })).toBeInTheDocument());
    // 117 kr arvode + 29 kr moms + 63 kr utlägg = 209 kr.
    const card = screen.getByRole("heading", { name: /Underlag/i }).parentElement!;
    expect(card.textContent?.replace(/\s/g, "")).toContain("209,00");
    unmount();
    invoiceQuery.data = { ...baseInvoice, invoiceType: "FINAL", ...entries };
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Underlag/i })).toBeInTheDocument());
    // 116,67 + 29,17 + 62,49 = 208,33 kr — den äldre fakturans öresavrundning.
    const legacy = screen.getByRole("heading", { name: /Underlag/i }).parentElement!;
    expect(legacy.textContent?.replace(/\s/g, "")).toContain("208,33");
  });

  it("tidsspecifikationen visar tiden i decimaltimmar (#1543)", async () => {
    invoiceQuery.data = { ...baseInvoice, invoiceType: "FINAL", timeEntries: [
      { id: "t1", date: new Date("2026-03-01"), description: "Möte", minutes: 90, hourlyRate: 100_000 },
      { id: "t2", date: new Date("2026-03-02"), description: "Brev", minutes: 15, hourlyRate: 100_000 },
    ] };
    renderPage();
    await waitFor(() => expect(screen.getByText("Möte")).toBeInTheDocument());
    expect(screen.getByText("Möte").closest("tr")?.textContent).toContain("1,5 h");
    expect(screen.getByText("Brev").closest("tr")?.textContent).toContain("0,25 h");
  });

  it("slutregleringens specifikation visar rader och summa i decimaltimmar (#1543)", async () => {
    const settlementBreakdown = { timeLines: [
      { date: "2026-03-01", description: "Möte", minutes: 90, amountOre: 150_000 },
      { date: "2026-03-02", description: "Brev", minutes: 15, amountOre: 25_000 },
    ], rows: [], totalLabel: "Att betala", totalOre: 175_000 };
    invoiceQuery.data = { ...baseInvoice, invoiceType: "FINAL", settlementBreakdown };
    renderPage();
    await waitFor(() => expect(screen.getByText("Möte")).toBeInTheDocument());
    expect(screen.getByText("Möte").closest("tr")?.textContent).toContain("1,5 h");
    expect(screen.getByText("Brev").closest("tr")?.textContent).toContain("0,25 h");
    expect(screen.getByText("Summa").closest("tr")?.textContent).toContain("1,75 h");
  });

  it("acontofakturan visar nedbrytningen ur sin egen kolumn (#2180)", async () => {
    const accontoBreakdown = { timeLines: [{ date: "2026-03-01", description: "Samtal", minutes: 60, amountOre: 100_000 }],
      rows: [], totalLabel: "Att betala", totalOre: 100_000 };
    invoiceQuery.data = { ...baseInvoice, invoiceType: "ACCONTO", accontoBreakdown };
    renderPage();
    await waitFor(() => expect(screen.getByText("Samtal")).toBeInTheDocument());
    expect(screen.getByText("Samtal").closest("tr")?.textContent).toContain("1 h");
  });

  it("tabellernas datarader är toppjusterade; summaraden i specifikationen är det inte (#1753)", async () => {
    const settlementBreakdown = { timeLines: [{ date: "2026-03-01", description: "Möte", minutes: 90, amountOre: 150_000 }],
      rows: [], totalLabel: "Att betala", totalOre: 150_000 };
    const writeOffs = [{ amount: 10_000, writtenOffAt: new Date("2026-04-02"), reason: "Konkurs" }];
    const accontoDeductions = [{ id: "ad1", accontoInvoice: { id: "ai1", invoiceDate: new Date("2026-03-01"), amount: 200_000 } }];
    invoiceQuery.data = { ...baseInvoice, invoiceType: "FINAL", settlementBreakdown, writeOffs };
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText("Möte")).toBeInTheDocument());
    for (const text of ["Möte", "Konkurs"]) expect(screen.getByText(text).closest("tr")).toHaveClass("align-top");
    expect(screen.getByText("Summa").closest("tr")).not.toHaveClass("align-top");
    unmount();
    invoiceQuery.data = { ...baseInvoice, invoiceType: "FINAL", accontoDeductions,
      timeEntries: [{ id: "t1", date: new Date("2026-03-01"), description: "Brev", minutes: 7, hourlyRate: 100_000 }],
      expenses: [{ id: "e1", date: new Date("2026-03-02"), description: "Porto", amount: 4_999, vatRate: 0, vatIncluded: false }] };
    renderPage();
    await waitFor(() => expect(screen.getByText("Brev")).toBeInTheDocument());
    for (const text of ["Brev", "Porto", /Aconto 2026-03-01/]) expect(screen.getByText(text).closest("tr")).toHaveClass("align-top");
  });

  it("renderar PAID-status utan Registrera betalning-knapp", async () => {
    invoiceQuery.data = { ...baseInvoice, status: "PAID" };
    renderPage();
    await waitFor(() => expect(screen.getByText("Betald")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Registrera betalning/i })).not.toBeInTheDocument();
  });

  it("Avbryt i Fel på fakturan?-dialogen stänger den", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Fel på fakturan\?/i }));
    expect(screen.getByRole("heading", { name: /Fel på fakturan\?/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("heading", { name: /Fel på fakturan\?/i })).not.toBeInTheDocument();
  });

  it("Avbryt i plan-modalen stänger den", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Skapa avbetalningsplan/i })),
    );
    expect(screen.getByRole("heading", { name: /Skapa avbetalningsplan/i })).toBeInTheDocument();
    const cancels = screen.getAllByRole("button", { name: /Avbryt/i });
    fireEvent.click(cancels[0]!);
    expect(screen.queryByRole("heading", { name: /Skapa avbetalningsplan/i })).not.toBeInTheDocument();
  });

  it("uppdaterar alla plan-input-fält", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Skapa avbetalningsplan/i })),
    );
    const monthly = screen.getByLabelText<HTMLInputElement>(/Månadsbelopp/);
    fireEvent.change(monthly, { target: { value: "1500" } });
    expect(monthly.value).toBe("1500");

    const day = screen.getByLabelText<HTMLInputElement>(/Förfallodag/);
    fireEvent.change(day, { target: { value: "15" } });
    expect(day.value).toBe("15");

    const startDate = screen.getByLabelText<HTMLInputElement>(/Startdatum/);
    fireEvent.change(startDate, { target: { value: "2026-06-01" } });
    expect(startDate.value).toBe("2026-06-01");

    const notes = screen.getByLabelText<HTMLTextAreaElement>(/^Notering$/);
    fireEvent.change(notes, { target: { value: "Avbetalningsplan" } });
    expect(notes.value).toBe("Avbetalningsplan");

    fireEvent.click(screen.getByRole("button", { name: /Skapa plan/i }));
    const arg = stubs.createPaymentPlan.mutate.mock.calls[0]![0];
    expect(arg.monthlyAmount).toBe(150000);
    expect(arg.dayOfMonth).toBe(15);
    expect(arg.startDate).toBe("2026-06-01");
    expect(arg.notes).toBe("Avbetalningsplan");
  });

  it("Fakturadokument: klick på dokumentnamnet ÖPPNAR dokumentet (ny flik), navigerar INTE in i ärendet", async () => {
    // Regressionsskydd för den jagade buggen: dokumentnamnet i Fakturadokument-
    // panelen länkade till /matters → man dirigerades in i ärendet istället för
    // att få upp PDF:en. Nu ska det vara en knapp som öppnar dokumentet.
    invoiceQuery.data = {
      ...baseInvoice,
      documents: [
        { id: "faktura-i1", fileName: "Faktura 2026-0001.pdf", documentType: "Faktura", storagePath: "documents/content/faktura-i1.pdf" },
      ],
    };
    renderPage();
    const docEl = await waitFor(() => screen.getByText("Faktura 2026-0001.pdf"));

    // 1) Det är en KNAPP, inte en länk till ärendet.
    expect(docEl.tagName).toBe("BUTTON");
    expect(docEl.closest("a")).toBeNull();

    // 2) Klick öppnar dokumentet via openDocument (med en openUrl → ny flik),
    //    snarare än att navigera. Verifiera rätt dokument-id.
    fireEvent.click(docEl);
    await waitFor(() => expect(openDocumentMock).toHaveBeenCalledTimes(1));
    const deps = openDocumentMock.mock.calls[0]![0] as { doc: { id: string; fileName: string }; openUrl: unknown };
    expect(deps.doc).toMatchObject({ id: "faktura-i1", fileName: "Faktura 2026-0001.pdf" });
    expect(typeof deps.openUrl).toBe("function");
  });

  it("uppdaterar betalningsdatum och anteckning i betalnings-modal", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Registrera betalning/i })),
    );
    const date = screen.getByLabelText<HTMLInputElement>(/Betalningsdatum/);
    fireEvent.change(date, { target: { value: "2026-04-20" } });
    const note = screen.getByLabelText<HTMLInputElement>(/^Notering$/);
    fireEvent.change(note, { target: { value: "Banköverföring" } });
    const amount = screen.getByLabelText<HTMLInputElement>(/^Belopp/);
    fireEvent.change(amount, { target: { value: "100" } });
    const sparaBtns = screen.getAllByRole("button", { name: /^Spara$/i });
    fireEvent.click(sparaBtns[sparaBtns.length - 1]!);
    const arg = stubs.recordPayment.mutate.mock.calls[0]![0];
    expect(arg.paidAt).toBe("2026-04-20");
    expect(arg.note).toBe("Banköverföring");
    expect(arg.amount).toBe(10000);
  });
});

/** Sista knappen med namnet — modalens knapp står efter sidans egen. */
function lastButton(name: RegExp | string): HTMLElement {
  const btn = screen.getAllByRole("button", { name }).at(-1);
  if (!btn) throw new Error(`knappen ${String(name)} saknas`);
  return btn;
}

/** En åtgärdsmodal: knappen som öppnar den, rubriken, ifyllnad och skicka-knappen. */
interface ModalCase { name: string; key: StubKey; open: RegExp; heading: RegExp; fill: () => void; submit: () => HTMLElement }

const MODAL_CASES: readonly ModalCase[] = [
  { name: "betalning", key: "recordPayment", open: /Registrera betalning/i, heading: /Registrera betalning/i,
    fill: () => fireEvent.change(screen.getByLabelText("Belopp (kr)"), { target: { value: "5000" } }),
    submit: () => lastButton(/^Spara$/i) },
  { name: "avbetalningsplan", key: "createPaymentPlan", open: /Skapa avbetalningsplan/i, heading: /Skapa avbetalningsplan/i,
    fill: () => fireEvent.change(screen.getByLabelText("Månadsbelopp (kr)"), { target: { value: "1000" } }),
    submit: () => screen.getByRole("button", { name: /Skapa plan/i }) },
  { name: "avskrivning", key: "writeOff", open: /Skriv av som kundförlust/i, heading: /Skriv av som kundförlust/i,
    fill: () => {}, submit: () => screen.getByRole("button", { name: "Skriv av" }) },
];

/** Öppna modalen, fyll i och skicka. */
async function submitModal(c: ModalCase): Promise<void> {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: c.open }));
  c.fill();
  fireEvent.click(c.submit());
}

describe("InvoiceDetailPage — serverns svar i åtgärdsmodalerna", () => {
  for (const c of MODAL_CASES) {
    it(`${c.name}: lyckat svar stänger modalen och hämtar fakturan om`, async () => {
      respond(c.key);
      await submitModal(c);
      expect(stubs[c.key].mutate).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("heading", { name: c.heading })).not.toBeInTheDocument();
      expect(utilsMock.invoice.getById.invalidate).toHaveBeenCalledWith({ id: "i1" });
      expect(utilsMock.invoice.list.invalidate).toHaveBeenCalled();
    });

    it(`${c.name}: serverfel visas i modalen, som står kvar`, async () => {
      respond(c.key, "Servern nekade");
      await submitModal(c);
      expect(screen.getByText("Servern nekade")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: c.heading })).toBeInTheDocument();
      expect(utilsMock.invoice.getById.invalidate).not.toHaveBeenCalled();
    });
  }

  it("Avbryt i avskrivningsmodalen stänger den och nollställer felet", async () => {
    const writeOff = MODAL_CASES.find((c) => c.key === "writeOff");
    if (!writeOff) throw new Error("avskrivningsfallet saknas");
    respond("writeOff", "Servern nekade");
    await submitModal(writeOff);
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("heading", { name: writeOff.heading })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: writeOff.open }));
    expect(screen.queryByText("Servern nekade")).not.toBeInTheDocument();
  });

  it("avskrivningen skickar ifyllt belopp, anledning och datum", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Skriv av som kundförlust/i }));
    fireEvent.change(screen.getByLabelText(/Belopp att skriva av/), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText("Anledning"), { target: { value: "Konkurs" } });
    fireEvent.change(screen.getByLabelText("Avskrivningsdatum"), { target: { value: "2026-05-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Skriv av" }));
    expect(stubs.writeOff.mutate).toHaveBeenCalledWith({
      invoiceId: "i1", amount: 250_000, reason: "Konkurs", writtenOffAt: "2026-05-10",
    });
  });
});

describe("InvoiceDetailPage — utskick och paneler", () => {
  it("Skicka faktura öppnar utskicksmodalen; Stäng stänger den", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Skicka faktura" }));
    expect(screen.getByRole("heading", { name: /Skicka faktura/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
    expect(screen.queryByRole("heading", { name: /Skicka faktura/ })).not.toBeInTheDocument();
  });

  it("köat utskick laddar om utskickshistoriken och fakturan och stänger modalen (#392)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Skicka faktura" }));
    fireEvent.change(screen.getByPlaceholderText("klient@example.se"), { target: { value: "k@x.se" } });
    fireEvent.click(screen.getByRole("button", { name: /Köa för automatiskt utskick/ }));
    expect(utilsMock.invoiceDispatch.list.invalidate).toHaveBeenCalledWith({ invoiceId: "i1" });
    expect(utilsMock.invoice.getById.invalidate).toHaveBeenCalledWith({ id: "i1" });
    expect(utilsMock.invoice.list.invalidate).toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /Skicka faktura/ })).not.toBeInTheDocument();
  });

  it("avbetalningsplanen listar skickade påminnelser per typ", async () => {
    const reminders = [
      { id: "r1", type: "DUE", dueMonth: "2026-05", sentAt: new Date("2026-05-05T08:00:00Z") },
      { id: "r2", type: "OVERDUE", dueMonth: "2026-06", sentAt: new Date("2026-06-15T08:00:00Z") },
    ];
    invoiceQuery.data = { ...baseInvoice, paymentPlan: {
      id: "pp1", monthlyAmount: 100_000, dayOfMonth: 5, startDate: new Date("2026-04-01"), status: "ACTIVE", notes: null, reminders,
    } };
    renderPage();
    expect(await screen.findByText(/2026-05 — Månadspåminnelse skickat/)).toBeInTheDocument();
    expect(screen.getByText(/2026-06 — Förseningspåminnelse skickat/)).toBeInTheDocument();
  });

  it("slutregleringens beloppstrappa visar avdrag med minus och info-rader inom parentes (#876)", async () => {
    const settlementBreakdown = { timeLines: [], totalLabel: "Att betala", totalOre: 80_000, rows: [
      { label: "Beviljat belopp", amountOre: 100_000, kind: "add" },
      { label: "Avgår prutning", amountOre: 20_000, kind: "deduct" },
      { label: "Varav moms", amountOre: 16_000, kind: "info" },
    ] };
    invoiceQuery.data = { ...baseInvoice, invoiceType: "FINAL", settlementBreakdown };
    renderPage();
    const amountOf = (label: string) => screen.getByText(label).nextElementSibling?.textContent.replace(/\s/g, "");
    expect(await screen.findByText("Beviljat belopp")).toBeInTheDocument();
    expect(amountOf("Beviljat belopp")).toMatch(/^1000,00/);
    expect(amountOf("Avgår prutning")).toMatch(/^−200,00/);
    expect(amountOf("Varav moms")).toMatch(/^\(160,00.*\)$/);
  });

  it("betalningstabellen sorteras på datum, registrerare och belopp", async () => {
    invoiceQuery.data = { ...baseInvoice, payments: [
      { id: "p1", amount: 250_000, paidAt: new Date("2026-04-15"), note: "Bankgiro", recordedBy: { name: "Ada" } },
      { id: "p2", amount: 100_000, paidAt: new Date("2026-04-20"), note: "Swish", recordedBy: { name: "Bertil" } },
    ] };
    renderPage();
    await screen.findByText("Bankgiro");
    const notes = ["Bankgiro", "Swish"];
    sortColumn("Datum", "desc");
    expect(rowOrder(notes)).toEqual(["Swish", "Bankgiro"]);
    sortColumn("Registrerad av", "asc");
    expect(rowOrder(notes)).toEqual(["Bankgiro", "Swish"]);
    sortColumn("Belopp", "asc");
    expect(rowOrder(notes)).toEqual(["Swish", "Bankgiro"]);
  });

  it("Fakturadokument: öppningen ger ny flik, felruta, FSA-handtaget och serverhämtningen", async () => {
    const doc = { id: "faktura-i1", fileName: "Faktura 2026-0001.pdf", storagePath: "documents/content/abc.pdf" };
    invoiceQuery.data = { ...baseInvoice, documents: [doc] };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderPage();
    fireEvent.click(await screen.findByText(doc.fileName));
    await waitFor(() => expect(openDocumentMock).toHaveBeenCalledTimes(1));
    const deps: { openUrl: (u: string) => void; notifyError: (m: string) => void; loadHandle: () => Promise<unknown>; fetchBlob: () => Promise<unknown> } =
      openDocumentMock.mock.calls[0]?.[0];
    deps.openUrl("blob:faktura");
    expect(open).toHaveBeenCalledWith("blob:faktura", "_blank", "noopener,noreferrer");
    deps.notifyError("Kunde inte öppna");
    expect(alertSpy).toHaveBeenCalledWith("Kunde inte öppna");
    await deps.loadHandle();
    expect(loadHandleMock).toHaveBeenCalledWith("repo-root");
    await deps.fetchBlob();
    expect(loadDocumentBlobMock).toHaveBeenCalledWith(utilsMock.client, doc);
    open.mockRestore();
    alertSpy.mockRestore();
  });
});
