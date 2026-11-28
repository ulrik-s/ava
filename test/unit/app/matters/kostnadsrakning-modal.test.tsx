/**
 * Test för KostnadsrakningModal — rättssals-flödet: rendering av sektionerna
 * (huvudförhandling, ersättningstyp, förhandsvisning, helper-status) + stäng-
 * vägarna (Avbryt-knapp + Escape) + att det genererade dokumentet länkas till
 * körningen som skapas när PDF:en renderats (#1230).
 *
 * buildKostnadsrakningContext körs på riktigt (ren beräkning); tunga
 * sidoeffekter (PDF-render, persist, helper) stubbas; tRPC går över en falsk
 * länk med en riktig QueryClient (#1929).
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { effectiveHearing } from "@/app/matters/[id]/_hearing-time";
import { KostnadsrakningModal } from "@/app/matters/[id]/_kostnadsrakning-modal";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, testQueryClient, TrpcTestProvider, type FakeTrpcLink, type TrpcHandlers } from "../../../helpers/trpc-fake";

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

/** En "Deltagit i förhandling"-post — med den visas förhandlingsklockan. */
const HEARING = { id: "te-h", date: "2026-03-01", minutes: 120, description: "Huvudförhandling", hourlyRate: 162_600, kind: "FORHANDLING" as const, billable: true };
const ARBETE = { id: "te-a", date: "2026-02-20", minutes: 90, description: "Genomgång av handlingar", hourlyRate: 162_600, kind: "ARBETE" as const, billable: true };
/** Ett förhör (#1855) en vardag kl. 10.00, 45 minuter. */
const FORHOR = { id: "te-f", date: "2026-03-04T09:00:00.000Z", minutes: 45, description: "Förhör", hourlyRate: 162_600, kind: "FORHOR" as const, billable: true };
let entries: Array<typeof HEARING | typeof ARBETE | typeof FORHOR> = [HEARING];
let entriesLoading = false;
/** Ett ofryst och ett redan fryst utlägg (#1889): bara det ofrysta finns i förslaget. */
const RESA = { id: "ex-r", date: "2026-02-21", description: "Resa", amount: 40_000, billable: true };
const FRYST = { id: "ex-f", date: "2026-01-10", description: "Fryst kopia", amount: 9_900, billable: true };
let unbilledExpenses: Array<typeof RESA> = [];

/** Förslaget ur posterna, med ett fast värde per tidspost. */
function proposalOf(te: ReadonlyArray<{ id: string; description: string; billable: boolean; date: string }>, ex: ReadonlyArray<typeof RESA>) {
  return { timeEntries: te.map((t) => ({ ...t, valueOre: 100_000 })), expenses: ex };
}

const handlers: TrpcHandlers = {
  "matter.update": () => ({ id: "m1" }),
  "kostnadsrakning.record": () => ({ ok: true }),
  // Inläsningen av tidsposterna (`entriesLoading`) blir aldrig klar.
  "timeEntry.list": () => (entriesLoading ? new Promise(() => {}) : { entries }),
  // Postlistan (#1889) läser fakturaförslaget: de ofrysta posterna.
  "billingRun.proposal": () => proposalOf(entries, unbilledExpenses),
};

let fake: FakeTrpcLink = fakeTrpcLink(handlers);

/** Indata till `kostnadsrakning.record`. */
const recorded = (): unknown[] => fake.calls.filter((c) => c.path === "kostnadsrakning.record").map((c) => c.input);

/** Renderar modalen och väntar tills postlistan har lästs in (eller fastnat i inläsning). */
async function renderModal(ui: ReactElement): Promise<void> {
  fake = fakeTrpcLink(handlers);
  const queryClient = testQueryClient();
  render(<TrpcTestProvider link={fake.link} queryClient={queryClient}>{ui}</TrpcTestProvider>);
  await waitFor(() => expect(fake.calls.length).toBeGreaterThanOrEqual(2));
  if (!entriesLoading) await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

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
  unbilledExpenses = [];
});

describe("KostnadsrakningModal — utan förhandling (ärendet lades ner)", () => {
  beforeEach(() => { entries = [ARBETE]; });

  it("tidsspecifikationen visar tiden i decimaltimmar (#1543)", async () => {
    await renderModal(<KostnadsrakningModal {...baseProps} />);
    const summary = screen.getByText("Tidsspecifikation").parentElement?.textContent ?? "";
    expect(summary).toContain("1,5 h + HUF 0 h");
    expect(summary).toContain("= 1,5 h");
  });

  it("visar ingen förhandlingsklocka och inget taxeval, utan en förklaring", async () => {
    await renderModal(<KostnadsrakningModal {...baseProps} />);
    expect(screen.queryByText(/STOPPA NU/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Taxa \(brottmålstaxan/)).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Ingen förhandling");
  });

  it("Generera går utan förhandlingstid och yrkar bara ärendets poster: 0 min, ingen taxa", async () => {
    const createRun = vi.fn().mockResolvedValue(asId<"BillingRunId">("run-2"));
    await renderModal(<KostnadsrakningModal {...baseProps} createRun={createRun} />);
    const generate = screen.getByRole("button", { name: /Generera/ });
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    await waitFor(() => expect(createRun).toHaveBeenCalled());
    const claim = createRun.mock.calls[0]?.[0] as { hufStart: string; hufEnd: string; isTaxeArende: boolean };
    expect(claim.hufEnd).toBe(claim.hufStart);
    expect(claim.isTaxeArende).toBe(false);
    await waitFor(() => expect(recorded()).toEqual([expect.objectContaining({ huvudforhandlingMinutes: 0 })]));
  });

  it("medan posterna läses in går det inte att generera", async () => {
    entriesLoading = true;
    await renderModal(<KostnadsrakningModal {...baseProps} />);
    expect(screen.getByText(/Läser in ärendets poster/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generera/ })).toBeDisabled();
  });
});

describe("KostnadsrakningModal — förordnandemål (#1858)", () => {
  const props = { ...baseProps, isOffentligtUppdrag: true };

  it("utan förhandlingspost: Ersättningstyp med förordnandetaxa och icke-taxa, icke-taxa förvald", async () => {
    entries = [ARBETE, FORHOR];
    await renderModal(<KostnadsrakningModal {...props} />);
    expect(screen.getByLabelText(/Icke-taxa/)).toBeChecked();
    expect(screen.getByLabelText(/Förordnandetaxa \(DVFS 2025:5\)/)).not.toBeChecked();
    expect(screen.queryByLabelText(/Taxa \(brottmålstaxan/)).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Ingen förhandling");
  });

  it("med förhandlingspost: tre val, brottmålstaxan förvald som i dag", async () => {
    await renderModal(<KostnadsrakningModal {...props} />);
    expect(screen.getByLabelText(/Taxa \(brottmålstaxan/)).toBeChecked();
    expect(screen.getByLabelText(/Förordnandetaxa/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Icke-taxa/)).toBeInTheDocument();
  });

  it("förordnandetaxan: ingen klocka, förhören visas, och avslutet krävs innan Generera", async () => {
    entries = [HEARING, FORHOR];
    await renderModal(<KostnadsrakningModal {...props} />);
    fireEvent.click(screen.getByLabelText(/Förordnandetaxa/));
    expect(screen.queryByText(/STOPPA NU/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Förhör")).toHaveTextContent("1 förhör, sammanlagt 0,75 h");
    expect(screen.getByRole("button", { name: /Generera/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Lades ned"));
    expect(screen.getByRole("button", { name: /Generera/ })).toBeEnabled();
    expect(screen.getByLabelText("Förhör")).toHaveTextContent("Förundersökningen lades ned — förordnandemål (DVFS 2025:5)");
  });

  it("Generera skickar forordnande: { avslut } och F-skatt", async () => {
    entries = [ARBETE, FORHOR];
    const createRun = vi.fn().mockResolvedValue(asId<"BillingRunId">("run-f"));
    await renderModal(<KostnadsrakningModal {...props} createRun={createRun} />);
    fireEvent.click(screen.getByLabelText(/Förordnandetaxa/));
    fireEvent.click(screen.getByLabelText("Strafföreläggande godkändes"));
    fireEvent.click(screen.getByRole("button", { name: /Generera/ }));
    await waitFor(() => expect(createRun).toHaveBeenCalledWith({ forordnande: { avslut: "STRAFFORELAGGANDE" }, hasFTax: true }, {}));
    await waitFor(() => expect(recorded()).toEqual([expect.objectContaining({ huvudforhandlingMinutes: 0 })]));
  });

  it("tillbaka till icke-taxa: klockans val och förklaringen som förut", async () => {
    entries = [ARBETE, FORHOR];
    await renderModal(<KostnadsrakningModal {...props} />);
    fireEvent.click(screen.getByLabelText(/Förordnandetaxa/));
    fireEvent.click(screen.getByLabelText(/Icke-taxa/));
    expect(screen.queryByLabelText("Förhör")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Ingen förhandling");
  });

  it("inte offentligt uppdrag: inget förordnandeval", async () => {
    entries = [ARBETE];
    await renderModal(<KostnadsrakningModal {...baseProps} />);
    expect(screen.queryByLabelText(/Förordnandetaxa/)).not.toBeInTheDocument();
    expect(screen.queryByText("Ersättningstyp")).not.toBeInTheDocument();
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
  it("renderar rubrik med målnummer", async () => {
    await renderModal(<KostnadsrakningModal {...baseProps} />);
    expect(screen.getByText(/Kostnadsräkning · 2026-0017/)).toBeInTheDocument();
  });

  it("visar STOPPA NU och förhandsvisning med total", async () => {
    await renderModal(<KostnadsrakningModal {...baseProps} />);
    expect(screen.getByText(/STOPPA NU/)).toBeInTheDocument();
    expect(screen.getByText("Förhandsvisning")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("visar ersättningstyp-valen (taxa / icke-taxa)", async () => {
    await renderModal(<KostnadsrakningModal {...baseProps} />);
    expect(screen.getByText(/Taxa \(brottmålstaxan/)).toBeInTheDocument();
    expect(screen.getByText(/Icke-taxa/)).toBeInTheDocument();
  });

  it("Avbryt-knappen anropar onClose", async () => {
    const onClose = vi.fn();
    await renderModal(<KostnadsrakningModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Avbryt"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Generera: skapar körningen och registrerar dokumentet länkat till den (#1230)", async () => {
    const createRun = vi.fn().mockResolvedValue(asId<"BillingRunId">("run-9"));
    await renderModal(<KostnadsrakningModal {...baseProps} createRun={createRun} />);
    fireEvent.click(screen.getByText("Generera + spara"));
    await waitFor(() => expect(recorded()).toHaveLength(1));
    expect(createRun).toHaveBeenCalledOnce();
    expect(recorded()[0]).toMatchObject({ matterId: "m1", billingRunId: "run-9" });
  });

  it("Generera: skickar dialogens huvudförhandling, nivå och taxeval med inskicket — servern yrkar samma taxa (#1024)", async () => {
    const createRun = vi.fn().mockResolvedValue(asId<"BillingRunId">("run-9"));
    await renderModal(<KostnadsrakningModal {...baseProps} initialLevel={2} createRun={createRun} />);
    fireEvent.click(screen.getByText("Generera + spara"));
    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    const sent = createRun.mock.calls[0]?.[0] as { hufStart: string; hufEnd: string; taxaLevel: number; isTaxeArende: boolean };
    expect(sent).toMatchObject({ taxaLevel: 2, isTaxeArende: true, hasFTax: true });
    expect(new Date(sent.hufStart).toISOString()).toBe(new Date("2026-03-01T09:00").toISOString());
    expect(new Date(sent.hufEnd).getTime()).toBeGreaterThan(new Date(sent.hufStart).getTime());
  });

  it("Escape stänger modalen", async () => {
    const onClose = vi.fn();
    await renderModal(<KostnadsrakningModal {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("KostnadsrakningModal — postlistan (#1889)", () => {
  /** Kryssrutan för en post i listan, ur dess beskrivning. */
  const box = (label: string): HTMLElement => {
    const row = screen.getAllByText(label).map((el) => el.closest("label")).find((l) => l !== null);
    if (!row) throw new Error(`raden ${label} saknas`);
    return within(row).getByRole("checkbox");
  };
  const total = (): string => screen.getByText("Total").nextElementSibling?.textContent ?? "";

  it("listan står före förhandsvisningen, med de ofrysta posterna förvalda", async () => {
    entries = [HEARING, ARBETE];
    await renderModal(<KostnadsrakningModal {...baseProps} />);
    const list = screen.getByText(/Poster att fakturera \(2\/2 valda\)/);
    expect(list.compareDocumentPosition(screen.getByText("Förhandsvisning")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("orörd lista: inga id:n skickas — servern tar allt ofryst", async () => {
    const createRun = vi.fn().mockResolvedValue(asId<"BillingRunId">("run-1"));
    await renderModal(<KostnadsrakningModal {...baseProps} createRun={createRun} />);
    fireEvent.click(screen.getByText("Generera + spara"));
    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    expect(createRun.mock.calls[0]?.[1]).toEqual({});
  });

  it("summan följer urvalet, och de valda id:na skickas med", async () => {
    entries = [HEARING, ARBETE];
    unbilledExpenses = [RESA];
    const createRun = vi.fn().mockResolvedValue(asId<"BillingRunId">("run-1"));
    await renderModal(<KostnadsrakningModal {...baseProps} initialIsTaxe={false} expenses={[RESA, FRYST]} createRun={createRun} />);
    const before = total();
    fireEvent.click(box("Resa"));
    expect(total()).not.toBe(before);
    expect(screen.getByText(/Utlägg inkl moms \(0 st\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Generera + spara"));
    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    expect(createRun.mock.calls[0]?.[1]).toEqual({ timeEntryIds: ["te-h", "te-a"], expenseIds: [] });
  });

  it("dokumentet får bara ofrysta utlägg — det redan frysta är inte med", async () => {
    unbilledExpenses = [RESA];
    await renderModal(<KostnadsrakningModal {...baseProps} expenses={[RESA, FRYST]} />);
    expect(screen.getByText(/Utlägg inkl moms \(1 st\)/)).toBeInTheDocument();
  });

  it("förhandlingsklockan följer de valda: utan den valda förhandlingsposten ingen klocka", async () => {
    entries = [HEARING, ARBETE];
    await renderModal(<KostnadsrakningModal {...baseProps} />);
    expect(screen.getByText(/STOPPA NU/)).toBeInTheDocument();
    fireEvent.click(box("Huvudförhandling"));
    expect(screen.queryByText(/STOPPA NU/)).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Ingen förhandling");
  });
});
