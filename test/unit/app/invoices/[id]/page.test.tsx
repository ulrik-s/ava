/**
 * Test för InvoiceDetailPage — fakturalisning, betalningar, plan, kreditera.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import InvoiceDetailPage from "@/app/invoices/[id]/_client";

const invoiceQuery = {
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
  error: null as Error | null,
};

const utilsMock = {
  invoice: {
    getById: { invalidate: vi.fn() },
    list: { invalidate: vi.fn() },
  },
};
const stubs = {
  recordPayment: { mutate: vi.fn(), isPending: false },
  createPaymentPlan: { mutate: vi.fn(), isPending: false },
  cancelPaymentPlan: { mutate: vi.fn(), isPending: false },
  setStatus: { mutate: vi.fn(), isPending: false },
  createCredit: { mutate: vi.fn(), isPending: false },
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    invoice: {
      getById: { useQuery: () => invoiceQuery },
      recordPayment: { useMutation: () => stubs.recordPayment },
      createPaymentPlan: { useMutation: () => stubs.createPaymentPlan },
      cancelPaymentPlan: { useMutation: () => stubs.cancelPaymentPlan },
      setStatus: { useMutation: () => stubs.setStatus },
      createCredit: { useMutation: () => stubs.createCredit },
    },
  },
}));

// Fakturadokument-panelen ska ÖPPNA dokumentet (ny flik) via openDocument —
// INTE navigera in i ärendet. Mocka open-document-flödet för att verifiera.
const openDocumentMock = vi.fn();
vi.mock("@/lib/client/firma/open-document", () => ({
  openDocument: (deps: unknown) => openDocumentMock(deps),
}));
vi.mock("@/lib/client/fsa/handle-store", () => ({ loadHandle: vi.fn(async () => null) }));
vi.mock("@/lib/client/fsa/read-from-fsa", () => ({ readFromFsa: vi.fn(async () => null) }));

function makeParams(value: { id: string }) {
  const p = Promise.resolve(value) as Promise<{ id: string }> & {
    status?: string;
    value?: { id: string };
  };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

const params = makeParams({ id: "i1" });
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
  invoiceQuery.isLoading = false;
  invoiceQuery.error = null;
  stubs.recordPayment.mutate = vi.fn();
  stubs.createPaymentPlan.mutate = vi.fn();
  stubs.cancelPaymentPlan.mutate = vi.fn();
  stubs.setStatus.mutate = vi.fn();
  stubs.createCredit.mutate = vi.fn();
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

  it("renderar Acconto-rubrik för ACCONTO-typ", async () => {
    invoiceQuery.data = { ...baseInvoice, invoiceType: "ACCONTO" };
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Acconto-faktura/i })).toBeInTheDocument(),
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

  it("visar Kreditera-knappen på SENT-faktura utan creditNote", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Kreditera/i })).toBeInTheDocument(),
    );
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
    const numbers = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(numbers[0], { target: { value: "5000" } });
    const sparaBtns = screen.getAllByRole("button", { name: /^Spara$/i });
    fireEvent.click(sparaBtns[sparaBtns.length - 1]);
    expect(stubs.recordPayment.mutate).toHaveBeenCalled();
    expect(stubs.recordPayment.mutate.mock.calls[0][0]).toMatchObject({
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
    fireEvent.click(cancels[0]);
    expect(screen.queryByRole("heading", { name: /Registrera betalning/i })).not.toBeInTheDocument();
  });

  it("submittar avbetalningsplan med månadsbelopp och dag", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Skapa avbetalningsplan/i })),
    );
    const numberInputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(numberInputs[0], { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa plan/i }));
    expect(stubs.createPaymentPlan.mutate).toHaveBeenCalled();
    expect(stubs.createPaymentPlan.mutate.mock.calls[0][0]).toMatchObject({
      invoiceId: "i1",
      monthlyAmount: 100000,
    });
  });

  it("Skapa plan-knappen är disabled tills månadsbelopp anges", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Skapa avbetalningsplan/i })),
    );
    const skapaBtn = screen.getByRole("button", { name: /Skapa plan/i }) as HTMLButtonElement;
    expect(skapaBtn.disabled).toBe(true);
  });

  it("öppnar och submittar Kreditera-modal", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /^Kreditera$/i })),
    );
    expect(screen.getByRole("heading", { name: /Kreditera faktura/i })).toBeInTheDocument();
    const noteArea = screen.getByPlaceholderText(/anledning/i) as HTMLTextAreaElement;
    fireEvent.change(noteArea, { target: { value: "Felaktig fakturering" } });
    const krediteraBtns = screen.getAllByRole("button", { name: /Kreditera/i });
    fireEvent.click(krediteraBtns[krediteraBtns.length - 1]);
    expect(stubs.createCredit.mutate).toHaveBeenCalledWith({
      invoiceId: "i1",
      notes: "Felaktig fakturering",
    });
  });

  it("Annullera-knappen sätter status till CANCELLED", async () => {
    renderPage();
    const btn = await waitFor(() =>
      screen.getByRole("button", { name: /Annullera/i }),
    );
    fireEvent.click(btn);
    expect(stubs.setStatus.mutate).toHaveBeenCalledWith({
      invoiceId: "i1",
      status: "CANCELLED",
    });
  });

  it("Skriv av som kundförlust sätter BAD_DEBT", async () => {
    renderPage();
    const btn = await waitFor(() =>
      screen.getByRole("button", { name: /Skriv av/i }),
    );
    fireEvent.click(btn);
    expect(stubs.setStatus.mutate).toHaveBeenCalledWith({
      invoiceId: "i1",
      status: "BAD_DEBT",
    });
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
      expect(screen.getByRole("heading", { name: /Accontoavdrag/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/Acconto 2026-03-01/)).toBeInTheDocument();
  });

  it("renderar PAID-status utan Registrera betalning-knapp", async () => {
    invoiceQuery.data = { ...baseInvoice, status: "PAID" };
    renderPage();
    await waitFor(() => expect(screen.getByText("Betald")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Registrera betalning/i })).not.toBeInTheDocument();
  });

  it("Avbryt i Kreditera-modalen stänger den", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /^Kreditera$/i })),
    );
    expect(screen.getByRole("heading", { name: /Kreditera faktura/i })).toBeInTheDocument();
    const cancels = screen.getAllByRole("button", { name: /Avbryt/i });
    fireEvent.click(cancels[0]);
    expect(screen.queryByRole("heading", { name: /Kreditera faktura/i })).not.toBeInTheDocument();
  });

  it("Avbryt i plan-modalen stänger den", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Skapa avbetalningsplan/i })),
    );
    expect(screen.getByRole("heading", { name: /Skapa avbetalningsplan/i })).toBeInTheDocument();
    const cancels = screen.getAllByRole("button", { name: /Avbryt/i });
    fireEvent.click(cancels[0]);
    expect(screen.queryByRole("heading", { name: /Skapa avbetalningsplan/i })).not.toBeInTheDocument();
  });

  it("uppdaterar alla plan-input-fält", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Skapa avbetalningsplan/i })),
    );
    const monthly = screen.getByLabelText(/Månadsbelopp/) as HTMLInputElement;
    fireEvent.change(monthly, { target: { value: "1500" } });
    expect(monthly.value).toBe("1500");

    const day = screen.getByLabelText(/Förfallodag/) as HTMLInputElement;
    fireEvent.change(day, { target: { value: "15" } });
    expect(day.value).toBe("15");

    const startDate = screen.getByLabelText(/Startdatum/) as HTMLInputElement;
    fireEvent.change(startDate, { target: { value: "2026-06-01" } });
    expect(startDate.value).toBe("2026-06-01");

    const notes = screen.getByLabelText(/^Notering$/) as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Avbetalningsplan" } });
    expect(notes.value).toBe("Avbetalningsplan");

    fireEvent.click(screen.getByRole("button", { name: /Skapa plan/i }));
    const arg = stubs.createPaymentPlan.mutate.mock.calls[0][0];
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
    const deps = openDocumentMock.mock.calls[0][0] as { doc: { id: string; fileName: string }; openUrl: unknown };
    expect(deps.doc).toMatchObject({ id: "faktura-i1", fileName: "Faktura 2026-0001.pdf" });
    expect(typeof deps.openUrl).toBe("function");
  });

  it("uppdaterar betalningsdatum och anteckning i betalnings-modal", async () => {
    renderPage();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Registrera betalning/i })),
    );
    const date = screen.getByLabelText(/Betalningsdatum/) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-04-20" } });
    const note = screen.getByLabelText(/^Notering$/) as HTMLInputElement;
    fireEvent.change(note, { target: { value: "Banköverföring" } });
    const amount = screen.getByLabelText(/^Belopp/) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "100" } });
    const sparaBtns = screen.getAllByRole("button", { name: /^Spara$/i });
    fireEvent.click(sparaBtns[sparaBtns.length - 1]);
    const arg = stubs.recordPayment.mutate.mock.calls[0][0];
    expect(arg.paidAt).toBe("2026-04-20");
    expect(arg.note).toBe("Banköverföring");
    expect(arg.amount).toBe(10000);
  });
});
