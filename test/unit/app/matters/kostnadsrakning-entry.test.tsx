/**
 * Rättshjälpens kostnadsräkning på ett urval av poster (#1889).
 *
 * `RattshjalpKrDialog` (via `KostnadsrakningEntry` med betalningssättet
 * RATTSHJALP) visar postlistan före summan; summan följer urvalet, de valda
 * id:na skickas till servern, och dokumentet får exakt samma poster.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { KostnadsrakningEntry, type MatterContext } from "@/app/matters/[id]/_kostnadsrakning-entry";
import { asId } from "@/lib/shared/schemas/ids";

const T1 = { id: "t1", date: "2026-09-01", description: "Inläsning", minutes: 60, billable: true, valueOre: 150_000 };
const T2 = { id: "t2", date: "2026-10-01", description: "Möte", minutes: 30, billable: true, valueOre: 75_000 };
const E1 = { id: "e1", date: "2026-09-02", description: "Resa", amount: 40_000, billable: true };
const FROZEN = { id: "e-old", date: "2026-08-02", description: "Fryst", amount: 9_900, billable: true };

const mutateAsync = vi.fn((): Promise<{ run: { id: string } }> => Promise.resolve({ run: { id: "run-1" } }));
const generateKrDoc = vi.fn((_opts: { meta: Record<string, unknown> }): Promise<void> => Promise.resolve());
let createError: { message: string } | null = null;

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    billingRun: {
      proposal: { useQuery: () => ({ data: { timeEntries: [T1, T2], expenses: [E1] }, isLoading: false }) },
      createKostnadsrakning: { useMutation: () => ({ mutateAsync, isPending: false, error: createError }) },
    },
    timeEntry: { list: { useQuery: () => ({ data: { entries: [T1, T2] }, isLoading: false }) } },
    expense: { list: { useQuery: () => ({ data: { expenses: [E1, FROZEN] } }) } },
    user: { current: { useQuery: () => ({ data: { name: "Adv. Anna", email: "anna@byra.se" } }) } },
    organization: { getSettings: { useQuery: () => ({ data: { name: "Byrå AB" } }) } },
    document: { register: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    // Välj domstol (#1891).
    contacts: { search: { useQuery: () => ({ data: { contacts: [{ id: "c-hov", name: "Svea hovrätt", contactType: "COURT" }] }, isLoading: false }) } },
  },
}));
vi.mock("@/lib/client/kostnadsrakning/generate-kr-doc", () => ({ generateKrDoc }));

const MATTER: MatterContext = { matterNumber: "2026-0001", title: "Tvist", paymentMethod: "RATTSHJALP" };
const onClose = vi.fn();
const onRecorded = vi.fn();

function renderDialog() {
  return render(<KostnadsrakningEntry matterId={asId<"MatterId">("m1")} matter={MATTER} open onClose={onClose} onRecorded={onRecorded} />);
}

/** Kryssrutan för en post i listan, ur dess beskrivning. */
function box(label: string): HTMLElement {
  const row = screen.getByText(label).closest("label");
  if (!row) throw new Error(`raden ${label} saknas`);
  return within(row).getByRole("checkbox");
}

/** Beloppet på summaraden `label` (Arvode eller Utlägg). */
function amountOf(label: RegExp): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  createError = null;
});

describe("RattshjalpKrDialog — postlistan (#1889)", () => {
  it("listan står före summan, med alla ofrysta poster förvalda", () => {
    renderDialog();
    const list = screen.getByText("Poster att fakturera (3/3 valda)");
    expect(list.compareDocumentPosition(screen.getByText(/Arvode/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("summan följer urvalet", () => {
    renderDialog();
    const arvode = amountOf(/Arvode/);
    const utlagg = amountOf(/^Utlägg$/);
    fireEvent.click(box("Möte"));
    fireEvent.click(box("Resa"));
    expect(amountOf(/Arvode/)).not.toBe(arvode);
    expect(amountOf(/^Utlägg$/)).not.toBe(utlagg);
    expect(amountOf(/^Utlägg$/)).toMatch(/^0/);
  });

  it("orörd lista: inga id:n, och dokumentet får de ofrysta posterna — inte det frysta utlägget", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(generateKrDoc).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({ matterId: "m1" });
    expect(generateKrDoc).toHaveBeenCalledWith(expect.objectContaining({ timeEntries: [T1, T2], expenses: [E1], ownBillingRunId: "run-1" }));
    expect(onRecorded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("valda poster: id:na skickas, och dokumentet byggs på exakt dem", async () => {
    renderDialog();
    fireEvent.click(box("Möte"));
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(generateKrDoc).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({ matterId: "m1", timeEntryIds: ["t1"], expenseIds: ["e1"] });
    expect(generateKrDoc).toHaveBeenCalledWith(expect.objectContaining({ timeEntries: [T1], expenses: [E1] }));
  });

  it("servern vägrar: inget dokument, dialogen står kvar med felet", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("Någon vald post är redan fakturerad eller tillhör annat ärende."));
    createError = { message: "Någon vald post är redan fakturerad eller tillhör annat ärende." };
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(generateKrDoc).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/redan fakturerad/)).toBeInTheDocument();
  });

  it("ett dokument som misslyckas stoppar inte inskicket", async () => {
    generateKrDoc.mockRejectedValueOnce(new Error("pdf"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("RattshjalpKrDialog — domstol och målnummer (#1891)", () => {
  const WITH_COURT: MatterContext = {
    ...MATTER, courtCaseNumber: "T 55-26",
    contacts: [{ role: "DOMSTOL", contact: { name: "Stockholms tingsrätt" } }],
  };
  const renderWithCourt = () =>
    render(<KostnadsrakningEntry matterId={asId<"MatterId">("m1")} matter={WITH_COURT} open onClose={onClose} onRecorded={onRecorded} />);

  it("förvalt: ärendets domstol och målnummer i dokumentet, ingen vald kontakt till servern", async () => {
    renderWithCourt();
    expect(screen.getByLabelText("Målnummer")).toHaveValue("T 55-26");
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(generateKrDoc).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({ matterId: "m1" });
    expect(generateKrDoc).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ courtName: "Stockholms tingsrätt", courtCaseNumber: "T 55-26" }),
    }));
  });

  it("byt domstol: kontakten skickas, dokumentet får den nya domstolen och inget målnummer", async () => {
    renderWithCourt();
    fireEvent.click(screen.getByRole("button", { name: "Byt domstol…" }));
    fireEvent.change(screen.getByLabelText("Sök domstol"), { target: { value: "hov" } });
    fireEvent.click(screen.getByRole("button", { name: /Svea hovrätt/ }));
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(generateKrDoc).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({ matterId: "m1", courtContactId: "c-hov" });
    const meta = generateKrDoc.mock.calls[0]?.[0].meta;
    expect(meta.courtName).toBe("Svea hovrätt");
    expect(meta).not.toHaveProperty("courtCaseNumber");
  });
});
