import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { LedgerBooking } from "@/app/invoices/[id]/_ledger-booking";

const status: { data: { configured: boolean; connected: boolean } | undefined } = { data: undefined };
const book = { mutate: vi.fn(), isPending: false, error: null as { message: string } | null };
const invalidate = vi.fn();
let onSuccess: (() => void) | undefined;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ invoice: { getById: { invalidate } } }),
    ledger: {
      status: { useQuery: () => status },
      bookInvoice: { useMutation: (o: { onSuccess: () => void }) => { onSuccess = o.onSuccess; return book; } },
    },
  },
}));

const ID = "0190a3f0-0000-7000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  status.data = { configured: true, connected: true };
  book.isPending = false;
  book.error = null;
});

describe("LedgerBooking", () => {
  it("bokförd faktura visar verifikatet", () => {
    render(<LedgerBooking invoiceId={ID} status="SENT" fortnoxId="A/12" />);
    expect(screen.getByText(/Bokförd i Fortnox \(verifikat A\/12\)/)).toBeInTheDocument();
  });

  it("utan ansluten integration syns ingen knapp", () => {
    status.data = { configured: true, connected: false };
    const { container } = render(<LedgerBooking invoiceId={ID} status="SENT" fortnoxId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("utkast kan inte bokföras", () => {
    const { container } = render(<LedgerBooking invoiceId={ID} status="DRAFT" fortnoxId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("knappen bokför och laddar om fakturan", () => {
    render(<LedgerBooking invoiceId={ID} status="SENT" fortnoxId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Bokför i Fortnox" }));
    expect(book.mutate).toHaveBeenCalledWith({ invoiceId: ID });
    onSuccess?.();
    expect(invalidate).toHaveBeenCalledWith({ id: ID });
  });

  it("pågående och fel visas", () => {
    book.isPending = true;
    book.error = { message: "Fortnox 400" };
    render(<LedgerBooking invoiceId={ID} status="SENT" fortnoxId={null} />);
    expect(screen.getByRole("button", { name: "Bokför…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Kunde inte bokföra: Fortnox 400");
  });
});
