import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { LedgerBooking } from "@/app/invoices/[id]/_ledger-booking";

const status: { data: { configured: boolean; connected: boolean } | undefined } = { data: undefined };
const book = { mutate: vi.fn(), isPending: false, error: null as { message: string } | null };
const invalidate = vi.fn();
let onSettled: (() => void) | undefined;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ invoice: { getById: { invalidate } } }),
    ledger: {
      status: { useQuery: () => status },
      bookInvoice: { useMutation: (o: { onSettled: () => void }) => { onSettled = o.onSettled; return book; } },
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
    render(<LedgerBooking invoiceId={ID} status="SENT" fortnoxId="A/12" payments={[]} />);
    expect(screen.getByText(/Bokförd i Fortnox \(verifikat A\/12\)/)).toBeInTheDocument();
  });

  it("utan ansluten integration syns ingen knapp", () => {
    status.data = { configured: true, connected: false };
    const { container } = render(<LedgerBooking invoiceId={ID} status="SENT" fortnoxId={null} payments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("utkast kan inte bokföras", () => {
    const { container } = render(<LedgerBooking invoiceId={ID} status="DRAFT" fortnoxId={null} payments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("knappen bokför och laddar om fakturan", () => {
    render(<LedgerBooking invoiceId={ID} status="SENT" fortnoxId={null} payments={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Bokför i Fortnox" }));
    expect(book.mutate).toHaveBeenCalledWith({ invoiceId: ID });
    onSettled?.();
    expect(invalidate).toHaveBeenCalledWith({ id: ID });
  });

  it("pågående och fel visas", () => {
    book.isPending = true;
    book.error = { message: "Fortnox 400" };
    render(<LedgerBooking invoiceId={ID} status="SENT" fortnoxId={null} payments={[]} />);
    expect(screen.getByRole("button", { name: "Bokför…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Kunde inte bokföra: Fortnox 400");
  });

  it("bokförd faktura med nya betalningar: status + knapp för betalningarna", () => {
    render(<LedgerBooking invoiceId={ID} status="PAID" fortnoxId="A/12" payments={[{ fortnoxId: "A/13" }, { fortnoxId: null }, {}]} />);
    expect(screen.getByText(/verifikat A\/12\) · 1 betalning bokförd$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bokför 2 betalningar i Fortnox" })).toBeInTheDocument();
  });

  it("en ny betalning: singular", () => {
    render(<LedgerBooking invoiceId={ID} status="SENT" fortnoxId="A/12" payments={[{ fortnoxId: null }]} />);
    expect(screen.getByRole("button", { name: "Bokför 1 betalning i Fortnox" })).toBeInTheDocument();
  });

  it("allt bokfört: flera betalningar i plural, ingen knapp", () => {
    render(<LedgerBooking invoiceId={ID} status="PAID" fortnoxId="A/12" payments={[{ fortnoxId: "A/13" }, { fortnoxId: "A/14" }]} />);
    expect(screen.getByText(/2 betalningar bokförda/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
