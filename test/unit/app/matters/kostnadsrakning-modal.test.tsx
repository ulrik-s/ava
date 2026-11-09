/**
 * Test för KostnadsrakningModal — rättssals-flödet: rendering av sektionerna
 * (huvudförhandling, ersättningstyp, förhandsvisning, helper-status) + stäng-
 * vägarna (Avbryt-knapp + Escape) + att det genererade dokumentet länkas till
 * körningen som skapas när PDF:en renderats (#1230).
 *
 * buildKostnadsrakningContext körs på riktigt (ren beräkning); tunga
 * sidoeffekter (PDF-render, persist, helper, trpc) stubbas.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { effectiveHearing, KostnadsrakningModal } from "@/app/matters/[id]/_kostnadsrakning-modal";
import { asId } from "@/lib/shared/schemas/ids";

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
const recordMutateAsync = vi.fn().mockResolvedValue({});
/** En "Deltagit i förhandling"-post — med den visas förhandlingsklockan. */
const HEARING = { id: "te-h", date: "2026-03-01", minutes: 120, description: "Huvudförhandling", hourlyRate: 162_600, kind: "FORHANDLING" as const, billable: true };
const ARBETE = { id: "te-a", date: "2026-02-20", minutes: 90, description: "Genomgång av handlingar", hourlyRate: 162_600, kind: "ARBETE" as const, billable: true };
let entries: Array<typeof HEARING | typeof ARBETE> = [HEARING];
let entriesLoading = false;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ document: { list: { invalidate: vi.fn() }, tree: { invalidate: vi.fn(), refetch: vi.fn() } } }),
    matter: { update: { useMutation: noopMut } },
    kostnadsrakning: { record: { useMutation: () => ({ mutateAsync: recordMutateAsync, isPending: false }) } },
    timeEntry: { list: { useQuery: () => (entriesLoading ? { data: undefined, isLoading: true } : { data: { entries }, isLoading: false }) } },
  },
}));

const baseProps = {
  matterId: asId<"MatterId">("m1"),
  matterNumber: "2026-0017",
  matterTitle: "Brottmål Davidsson",
  clientName: "Erik Davidsson",
  defenderName: "Anna Advokat",
  expenses: [],
  initialHufStart: "2026-03-01T09:00", // i det förflutna → hufMin > 0
  initialIsTaxe: true,
  onClose: vi.fn(),
  createRun: vi.fn().mockResolvedValue(asId<"BillingRunId">("run-1")),
};

beforeEach(() => {
  vi.clearAllMocks();
  entries = [HEARING];
  entriesLoading = false;
});

describe("KostnadsrakningModal — utan förhandling (ärendet lades ner)", () => {
  beforeEach(() => { entries = [ARBETE]; });

  it("visar ingen förhandlingsklocka och inget taxeval, utan en förklaring", () => {
    render(<KostnadsrakningModal {...baseProps} />);
    expect(screen.queryByText(/STOPPA NU/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Taxa \(brottmålstaxan/)).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Ingen förhandling");
  });

  it("Generera går utan förhandlingstid och yrkar bara ärendets poster: 0 min, ingen taxa", async () => {
    const createRun = vi.fn().mockResolvedValue(asId<"BillingRunId">("run-2"));
    render(<KostnadsrakningModal {...baseProps} createRun={createRun} />);
    const generate = screen.getByRole("button", { name: /Generera/ });
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    await waitFor(() => expect(createRun).toHaveBeenCalled());
    const claim = createRun.mock.calls[0]?.[0] as { hufStart: string; hufEnd: string; isTaxeArende: boolean };
    expect(claim.hufEnd).toBe(claim.hufStart);
    expect(claim.isTaxeArende).toBe(false);
    await waitFor(() => expect(recordMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ huvudforhandlingMinutes: 0 })));
  });

  it("medan posterna läses in går det inte att generera", () => {
    entriesLoading = true;
    render(<KostnadsrakningModal {...baseProps} />);
    expect(screen.getByText(/Läser in ärendets poster/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generera/ })).toBeDisabled();
  });
});

describe("effectiveHearing", () => {
  it("med förhandling: dialogens tider och taxeval", () => {
    expect(effectiveHearing(true, "a", "b", true)).toEqual({ hufEnd: "b", isTaxe: true });
  });

  it("utan förhandling: 0 minuter och aldrig taxa", () => {
    expect(effectiveHearing(false, "a", "b", true)).toEqual({ hufEnd: "a", isTaxe: false });
  });
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

  it("Generera: skapar körningen och registrerar dokumentet länkat till den (#1230)", async () => {
    const createRun = vi.fn().mockResolvedValue(asId<"BillingRunId">("run-9"));
    render(<KostnadsrakningModal {...baseProps} createRun={createRun} />);
    fireEvent.click(screen.getByText("Generera + spara"));
    await waitFor(() => expect(recordMutateAsync).toHaveBeenCalled());
    expect(createRun).toHaveBeenCalledOnce();
    expect(recordMutateAsync.mock.calls[0]?.[0]).toMatchObject({ matterId: "m1", billingRunId: "run-9" });
  });

  it("Generera: skickar dialogens huvudförhandling, nivå och taxeval med inskicket — servern yrkar samma taxa (#1024)", async () => {
    const createRun = vi.fn().mockResolvedValue(asId<"BillingRunId">("run-9"));
    render(<KostnadsrakningModal {...baseProps} initialLevel={2} createRun={createRun} />);
    fireEvent.click(screen.getByText("Generera + spara"));
    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    const sent = createRun.mock.calls[0]?.[0] as { hufStart: string; hufEnd: string; taxaLevel: number; isTaxeArende: boolean };
    expect(sent).toMatchObject({ taxaLevel: 2, isTaxeArende: true, hasFTax: true });
    expect(new Date(sent.hufStart).toISOString()).toBe(new Date("2026-03-01T09:00").toISOString());
    expect(new Date(sent.hufEnd).getTime()).toBeGreaterThan(new Date(sent.hufStart).getTime());
  });

  it("Escape stänger modalen", () => {
    const onClose = vi.fn();
    render(<KostnadsrakningModal {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
