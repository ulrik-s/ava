/**
 * Test för InvoicesSection — listrendering, status-badges, knapp-states,
 * acconto-modalens grundflöde.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import { InvoicesSection } from "@/components/matter/invoices-section";

const invoicesQuery = { isLoading: false, data: [] as Array<Record<string, unknown>> };
const timeQuery: { data: { entries: Array<Record<string, unknown>> } } = { data: { entries: [] } };
const expenseQuery: { data: { expenses: Array<Record<string, unknown>> } } = { data: { expenses: [] } };
const utilsMock = {
  invoice: { list: { invalidate: vi.fn() } },
  timeEntry: { list: { invalidate: vi.fn() } },
  expense: { list: { invalidate: vi.fn() } },
  prefs: { get: { invalidate: vi.fn() } },
};
const createAccontoMutate = vi.fn();
const createFinalMutate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    invoice: {
      list: { useQuery: () => invoicesQuery },
      createAcconto: {
        useMutation: () => ({ mutate: createAccontoMutate, isPending: false }),
      },
      createFinal: {
        useMutation: () => ({ mutate: createFinalMutate, isPending: false }),
      },
    },
    timeEntry: {
      list: { useQuery: () => timeQuery },
    },
    expense: {
      list: { useQuery: () => expenseQuery },
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
  invoicesQuery.isLoading = false;
  invoicesQuery.data = [];
  timeQuery.data = { entries: [] };
  expenseQuery.data = { expenses: [] };
});

describe("InvoicesSection", () => {
  it("visar 'Inga fakturor ännu' när tom lista", () => {
    render(<InvoicesSection matterId="m1" />);
    expect(screen.getByText(/Inga fakturor/i)).toBeInTheDocument();
  });

  it("visar laddartext under loading", () => {
    invoicesQuery.isLoading = true;
    render(<InvoicesSection matterId="m1" />);
    expect(screen.getByText(/Laddar/i)).toBeInTheDocument();
  });

  it("renderar Acconto-rad med korrekt typ-badge", () => {
    invoicesQuery.data = [
      {
        id: "i1",
        invoiceType: "ACCONTO",
        status: "PAID",
        amount: 1000000,
        invoiceDate: new Date("2026-04-01"),
        deductedOnFinals: [],
      },
    ];
    render(<InvoicesSection matterId="m1" />);
    expect(screen.getByText("Acconto")).toBeInTheDocument();
    expect(screen.getByText("Betald")).toBeInTheDocument();
  });

  it("renderar Slutfaktura med korrekt typ-badge", () => {
    invoicesQuery.data = [
      {
        id: "i1",
        invoiceType: "FINAL",
        status: "SENT",
        amount: 2000000,
        invoiceDate: new Date("2026-04-01"),
        deductedOnFinals: [],
      },
    ];
    render(<InvoicesSection matterId="m1" />);
    expect(screen.getByText("Slutfaktura")).toBeInTheDocument();
    expect(screen.getByText("Skickad")).toBeInTheDocument();
  });

  it("renderar Kreditfaktura med korrekt label", () => {
    invoicesQuery.data = [
      {
        id: "i1",
        invoiceType: "CREDIT",
        status: "SENT",
        amount: -1000000,
        invoiceDate: new Date("2026-04-01"),
        deductedOnFinals: [],
      },
    ];
    render(<InvoicesSection matterId="m1" />);
    expect(screen.getByText("Kreditfaktura")).toBeInTheDocument();
  });

  it("öppnar acconto-modal vid klick på + Acconto", () => {
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Acconto/i }));
    expect(screen.getByText("Ny acconto-faktura")).toBeInTheDocument();
  });

  it("anropar createAcconto.mutate med rätt belopp i öre", () => {
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Acconto/i }));
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0]!, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Skapa$/ }));
    expect(createAccontoMutate).toHaveBeenCalledWith(
      expect.objectContaining({ matterId: "m1", amount: 500000 }),
    );
  });

  it("öppnar slutfaktura-modal vid klick på + Slutfaktura", () => {
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Slutfaktura/i }));
    // Modalen har en H3 med exakt texten "Skapa slutfaktura"
    expect(screen.getByRole("heading", { name: /Skapa slutfaktura/ })).toBeInTheDocument();
  });

  it("Avbryt stänger acconto-modalen", () => {
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Acconto/i }));
    expect(screen.getByText("Ny acconto-faktura")).toBeInTheDocument();
    const cancels = screen.getAllByRole("button", { name: /Avbryt/i });
    fireEvent.click(cancels[0]!);
    expect(screen.queryByText("Ny acconto-faktura")).not.toBeInTheDocument();
  });

  it("Skapa-knappen är disabled när belopp saknas", () => {
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Acconto/i }));
    const skapa = screen.getByRole("button", { name: /^Skapa$/ }) as HTMLButtonElement;
    expect(skapa.disabled).toBe(true);
  });

  it("Skapa slutfaktura är disabled när inget valts", () => {
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Slutfaktura/i }));
    const skapa = screen.getByRole("button", { name: /Skapa slutfaktura/ }) as HTMLButtonElement;
    expect(skapa.disabled).toBe(true);
  });

  it("renderar ofakturerade tidsposter och utlägg i slutfaktura-modal", () => {
    timeQuery.data = {
      entries: [
        {
          id: "t1",
          date: new Date("2026-04-01"),
          description: "Möte",
          minutes: 60,
          invoiceId: null,
        },
      ],
    };
    expenseQuery.data = {
      expenses: [
        {
          id: "e1",
          date: new Date("2026-04-02"),
          description: "Resa",
          amount: 5000,
          invoiceId: null,
        },
      ],
    };
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Slutfaktura/i }));
    expect(screen.getByText(/Möte/)).toBeInTheDocument();
    expect(screen.getByText(/Resa/)).toBeInTheDocument();
  });

  it("kryssar för en tidspost och submittar slutfaktura", () => {
    timeQuery.data = {
      entries: [
        {
          id: "t1",
          date: new Date("2026-04-01"),
          description: "Möte",
          minutes: 60,
          invoiceId: null,
        },
      ],
    };
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Slutfaktura/i }));
    const checkbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /Skapa slutfaktura/ }));
    expect(createFinalMutate).toHaveBeenCalledWith(
      expect.objectContaining({ matterId: "m1", timeEntryIds: ["t1"] }),
    );
  });

  it("renderar Öppna-länkar i fakturalistan", () => {
    invoicesQuery.data = [
      {
        id: "i-abc",
        invoiceType: "ACCONTO",
        status: "PAID",
        amount: 1000000,
        invoiceDate: new Date("2026-04-01"),
        deductedOnFinals: [],
      },
    ];
    render(<InvoicesSection matterId="m1" />);
    const link = screen.getByRole("link", { name: /Öppna/i }) as HTMLAnchorElement;
    expect(link.href).toContain("/invoices/__shell__");
    expect(link.href).toContain("id=i-abc");
    expect(link.href).not.toContain("/invoices/i-abc");
  });

  it("renderar BAD_DEBT-status med rätt label", () => {
    invoicesQuery.data = [
      {
        id: "i1",
        invoiceType: "FINAL",
        status: "BAD_DEBT",
        amount: 1000000,
        invoiceDate: new Date("2026-04-01"),
        deductedOnFinals: [],
      },
    ];
    render(<InvoicesSection matterId="m1" />);
    expect(screen.getByText("Kundförlust")).toBeInTheDocument();
  });

  it("renderar Utkast-status", () => {
    invoicesQuery.data = [
      {
        id: "i1",
        invoiceType: "FINAL",
        status: "DRAFT",
        amount: 1000000,
        invoiceDate: new Date("2026-04-01"),
        deductedOnFinals: [],
      },
    ];
    render(<InvoicesSection matterId="m1" />);
    expect(screen.getByText("Utkast")).toBeInTheDocument();
  });

  it("Avbryt stänger slutfaktura-modalen", () => {
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Slutfaktura/i }));
    expect(screen.getByRole("heading", { name: /Skapa slutfaktura/ })).toBeInTheDocument();
    const cancels = screen.getAllByRole("button", { name: /Avbryt/i });
    fireEvent.click(cancels[0]!);
    expect(screen.queryByRole("heading", { name: /Skapa slutfaktura/ })).not.toBeInTheDocument();
  });

  it("ändrar förfallodatum och notering i acconto-modalen", () => {
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Acconto/i }));
    const due = screen.getByLabelText(/Förfallodatum/) as HTMLInputElement;
    fireEvent.change(due, { target: { value: "2026-05-15" } });
    const note = screen.getByLabelText(/Notering/) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "Förskott Q2" } });
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0]!, { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Skapa$/ }));
    const arg = createAccontoMutate.mock.calls[0]![0];
    expect(arg.dueDate).toBe("2026-05-15");
    expect(arg.notes).toBe("Förskott Q2");
  });

  it("kryssar för utlägg och submittar slutfaktura", () => {
    expenseQuery.data = {
      expenses: [
        {
          id: "e1",
          date: new Date("2026-04-02"),
          description: "Resa",
          amount: 5000,
          invoiceId: null,
        },
      ],
    };
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Slutfaktura/i }));
    const checkbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /Skapa slutfaktura/ }));
    expect(createFinalMutate).toHaveBeenCalledWith(
      expect.objectContaining({ matterId: "m1", expenseIds: ["e1"] }),
    );
  });

  it("listar tillgängliga acconto-fakturor och tillåter avdrag", () => {
    invoicesQuery.data = [
      {
        id: "ac1",
        invoiceType: "ACCONTO",
        status: "PAID",
        amount: 200000,
        invoiceDate: new Date("2026-03-01"),
        deductedOnFinals: [],
      },
    ];
    timeQuery.data = {
      entries: [
        {
          id: "t1",
          date: new Date("2026-04-01"),
          description: "Möte",
          minutes: 60,
          invoiceId: null,
        },
      ],
    };
    render(<InvoicesSection matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Slutfaktura/i }));
    expect(screen.getByText(/Acconto 2026-03-01/)).toBeInTheDocument();
    // Kryssa för tidspost + acconto-avdrag
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(checkboxes[0]!); // time entry
    fireEvent.click(checkboxes[1]!); // acconto
    fireEvent.click(screen.getByRole("button", { name: /Skapa slutfaktura/ }));
    const arg = createFinalMutate.mock.calls[0]![0];
    expect(arg.accontoInvoiceIds).toEqual(["ac1"]);
  });
});
