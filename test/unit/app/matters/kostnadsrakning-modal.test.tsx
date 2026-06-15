/**
 * Test för KostnadsrakningModal — rättssals-flödet: rendering av sektionerna
 * (huvudförhandling, ersättningstyp, förhandsvisning, helper-status) + stäng-
 * vägarna (Avbryt-knapp + Escape). Generate-flödet (PDF) testas inte här.
 *
 * buildKostnadsrakningContext körs på riktigt (ren beräkning); tunga
 * sidoeffekter (PDF-render, persist, helper, trpc) stubbas.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { KostnadsrakningModal } from "@/app/matters/[id]/_kostnadsrakning-modal";

vi.mock("@/lib/client/helper/use-helper", () => ({
  useHelper: () => ({ checked: true, version: null }),
  composeMailViaHelper: vi.fn(),
}));
vi.mock("@/lib/client/kostnadsrakning/render-pdf", () => ({
  renderKostnadsrakningPdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));
vi.mock("@/lib/client/demo/persist-generated-doc", () => ({
  persistGeneratedDoc: vi.fn().mockResolvedValue(undefined),
}));

const noopMut = () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ document: { list: { invalidate: vi.fn() }, tree: { invalidate: vi.fn(), refetch: vi.fn() } } }),
    matter: { update: { useMutation: noopMut } },
    kostnadsrakning: { record: { useMutation: noopMut } },
    timeEntry: { list: { useQuery: () => ({ data: { entries: [] }, isLoading: false }) } },
  },
}));

const baseProps = {
  matterId: "m1",
  matterNumber: "2026-0017",
  matterTitle: "Brottmål Davidsson",
  clientName: "Erik Davidsson",
  defenderName: "Anna Advokat",
  expenses: [],
  initialHufStart: "2026-03-01T09:00", // i det förflutna → hufMin > 0
  initialIsTaxe: true,
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("KostnadsrakningModal", () => {
  it("renderar rubrik med målnummer", () => {
    render(<KostnadsrakningModal {...baseProps} />);
    expect(screen.getByText(/Kostnadsräkning · 2026-0017/)).toBeInTheDocument();
  });

  it("visar STOPPA NU och förhandsvisning med total", () => {
    render(<KostnadsrakningModal {...baseProps} />);
    expect(screen.getByText(/STOPPA NU/)).toBeInTheDocument();
    expect(screen.getByText("Förhandsvisning")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("visar ersättningstyp-valen (taxa / icke-taxa)", () => {
    render(<KostnadsrakningModal {...baseProps} />);
    expect(screen.getByText(/Taxa \(brottmålstaxan/)).toBeInTheDocument();
    expect(screen.getByText(/Icke-taxa/)).toBeInTheDocument();
  });

  it("Avbryt-knappen anropar onClose", () => {
    const onClose = vi.fn();
    render(<KostnadsrakningModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Avbryt"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape stänger modalen", () => {
    const onClose = vi.fn();
    render(<KostnadsrakningModal {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
