/**
 * Tester för ExpectedReceivablesSection (#27 coverage / #173) — förväntade
 * domstolsbetalningar: registrera fordran, avprickning
 * (markera mottagen) + avbryt, samt list-/tomtillstånd.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { ExpectedReceivablesSection } from "@/app/matters/[id]/_expected-receivables-section";
import { asId } from "@/lib/shared/schemas/ids";

const listQuery = { data: [] as unknown[], isLoading: false };
const createMutate = vi.fn();
const settleMutate = vi.fn();
const cancelMutate = vi.fn();
const invalidate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({
      expectedReceivable: { list: { invalidate } },
    }),
    expectedReceivable: {
      list: { useQuery: () => listQuery },
      create: { useMutation: (o?: { onSuccess?: () => void }) => ({ mutate: (a: unknown) => { createMutate(a); o?.onSuccess?.(); }, isPending: false }) },
      settle: { useMutation: (o?: { onSuccess?: () => void }) => ({ mutate: (a: unknown) => { settleMutate(a); o?.onSuccess?.(); }, isPending: false }) },
      cancel: { useMutation: (o?: { onSuccess?: () => void }) => ({ mutate: (a: unknown) => { cancelMutate(a); o?.onSuccess?.(); }, isPending: false }) },
    },
  },
}));

beforeEach(() => { vi.clearAllMocks(); listQuery.data = []; });

describe("ExpectedReceivablesSection", () => {
  it("tomtillstånd när inga fordringar finns", () => {
    render(<ExpectedReceivablesSection matterId={asId<"MatterId">("m1")} isCourtMatter />);
    expect(screen.getByText(/Inga registrerade ännu/)).toBeInTheDocument();
  });

  it("icke-domstolsärende utan fordringar → döljs helt (ej förvirrande)", () => {
    const { container } = render(<ExpectedReceivablesSection matterId={asId<"MatterId">("m1")} isCourtMatter={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Domstolsbetalningar/)).not.toBeInTheDocument();
  });

  it("icke-domstolsärende MEN med registrerad fordran → visas ändå (strandar inte data)", () => {
    listQuery.data = [{ id: "er-1", description: "Mål B 1-26", expectedAmount: 200_000, status: "PENDING" }];
    render(<ExpectedReceivablesSection matterId={asId<"MatterId">("m1")} isCourtMatter={false} />);
    expect(screen.getByText(/Domstolsbetalningar/)).toBeInTheDocument();
    expect(screen.getByText("Mål B 1-26")).toBeInTheDocument();
  });

  it("registrera fordran skickar description + belopp i öre", () => {
    render(<ExpectedReceivablesSection matterId={asId<"MatterId">("m1")} isCourtMatter />);
    fireEvent.change(screen.getByPlaceholderText(/Kostnadsräkning/), { target: { value: "Svea HovR" } });
    fireEvent.change(screen.getByPlaceholderText(/Begärt belopp/), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Lägg till fordran" }));
    expect(createMutate).toHaveBeenCalledWith({ matterId: "m1", description: "Svea HovR", expectedAmount: 150_000 });
  });

  it("PENDING-rad: markera mottagen bokar utbetalt belopp, avbryt avbryter", () => {
    listQuery.data = [{ id: "er-1", description: "Mål B 1-26", expectedAmount: 200_000, status: "PENDING" }];
    render(<ExpectedReceivablesSection matterId={asId<"MatterId">("m1")} isCourtMatter />);
    fireEvent.change(screen.getByPlaceholderText("Utbetalt (kr)"), { target: { value: "1800" } });
    fireEvent.click(screen.getByRole("button", { name: "Markera mottagen" }));
    expect(settleMutate).toHaveBeenCalledWith({ id: "er-1", settledAmount: 180_000 });
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(cancelMutate).toHaveBeenCalledWith({ id: "er-1" });
  });

  it("SETTLED-rad visar mottaget belopp och ingen avprickning", () => {
    listQuery.data = [{ id: "er-2", description: "Mål B 2-26", expectedAmount: 200_000, status: "SETTLED", settledAmount: 190_000 }];
    render(<ExpectedReceivablesSection matterId={asId<"MatterId">("m1")} isCourtMatter />);
    expect(screen.getByText(/Mottaget:/)).toBeInTheDocument();
    expect(screen.getByText("Mottagen")).toBeInTheDocument(); // status-label
    expect(screen.queryByRole("button", { name: "Markera mottagen" })).not.toBeInTheDocument();
  });
});
