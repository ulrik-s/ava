/**
 * Tester för `BillingPanel` (#27) — översikts-/action-panelen per ärende.
 *
 * Täcker summa-vyn (#819), optionsFor, findPendingVerdict,
 * clientOf/courtOf) via render + de villkorade vyerna: summa-kort, runs-lista,
 * pending-verdict-banner, rådgivnings-banner (rättshjälp) och "+ Skapa
 * faktura"-menyn vars alternativ beror på matter:s paymentMethod. Barn-
 * dialogerna stubbas (de har egna tester) så panelens egen logik isoleras.
 */

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { BillingPanel } from "@/app/matters/[id]/_billing-panel";
import type { MatterContext } from "@/app/matters/[id]/_kostnadsrakning-entry";
import { asId } from "@/lib/shared/schemas/ids";
import { callsTo, DATA_TABLE_HANDLERS, renderWithFakeTrpc, type FakeTrpcRender } from "../../../helpers/trpc-both-fake";
import { invalidatedPaths, type TrpcHandlers } from "../../../helpers/trpc-fake";

interface BillingRunRow {
  id: string; type: string; status: string; recipient: string;
  amountOre: number; createdAt: string | Date;
  invoiceId?: string | null; invoice?: { id: string; invoiceNumber?: string | null; status?: string } | null;
  reference?: string | null;
  kostnadsrakningStatus?: string | null; awardedOre?: number | null; beslutSlutgiltigt?: boolean | null;
  clientShareBips?: number | null; forordnandeAvslut?: string | null;
}

let runsData: { runs: BillingRunRow[] } = { runs: [] };
let runsLoading = false;
interface ProposalData { workValueOre: number; priorAccontoSumOre: number; timeEntries: Array<{ id: string; description: string; minutes: number; hourlyRate: number; billable: boolean; valueOre: number }>; expenses: Array<{ id: string; description: string; amount: number; billable: boolean }> }
let proposalData: ProposalData = { workValueOre: 0, priorAccontoSumOre: 0, timeEntries: [], expenses: [] };
interface InvoiceRow { id: string; amount: number; status: string; payments: Array<{ amount: number }>; invoiceNumber?: string; invoiceType?: string }
let invoiceListData: InvoiceRow[] = [];
let radgivningError: string | null = null;
/** Rådgivningsfakturan som skapas; `null` = anropet blir aldrig klart. */
let radgivningInvoice: Record<string, unknown> | null = null;
const persistGeneratedDoc = vi.fn(async () => {});
let createdRunId: string | null = null;
const generateKrDocFn = vi.fn(async () => {});
let documentListData: { documents: Array<Record<string, unknown>> } = { documents: [] };
let hasDoc = false;
const openGeneratedDocFn = vi.fn();
/** Släpper körningarna när `runsLoading` höll dem kvar. */
let releaseRuns: () => void = () => {};
let current: FakeTrpcRender | undefined;

/** Ett anrop som aldrig blir klart. */
const never = (): Promise<never> => new Promise(() => {});

/** Körningarna: direkt, eller (med `runsLoading`) först när testet släpper dem. */
function runsAnswer(): unknown {
  if (!runsLoading) return runsData;
  return new Promise((resolve) => { releaseRuns = () => resolve(runsData); });
}

/** Svaren för panelen och dess barn. Rådgivningsfakturan skapas aldrig klart (eller fallerar). */
function handlers(): TrpcHandlers {
  return {
    ...DATA_TABLE_HANDLERS,
    "prefs.save": () => ({}),
    "billingRun.list": runsAnswer,
    "billingRun.proposal": () => proposalData,
    "billingRun.coverageSplit": () => null,
    "billingRun.createKostnadsrakning": () => ({ run: { id: "run-new" } }),
    "billingRun.appealKostnadsrakning": () => ({}),
    "billingRun.voidKostnadsrakning": () => ({}),
    "billingRun.recordKostnadsrakningBeslut": () => ({}),
    "billingRun.recordInsurerPruning": () => ({}),
    "organization.getSettings": () => ({ name: "Byrå AB", orgNumber: "556677-8899", address: "Storgatan 1", logo: ORG_LOGO }),
    "user.current": () => ({ name: "Adv. Anna", email: "anna@byra.se" }),
    "expense.list": () => ({ expenses: [] }),
    "timeEntry.list": () => ({ entries: [] }),
    "timeEntry.radgivningStatus": () => ({ kind: "present", invoiceId: "inv-r" }),
    "document.list": () => documentListData,
    // KR-dokumentet slås upp i ärendets alla mappar (#1308).
    "document.tree": () => ({ folders: [], ...documentListData }),
    "document.register": () => ({}),
    // Kuvertform sedan #1014 — panelen läser `data.items`.
    "invoice.list": () => ({ items: invoiceListData, total: invoiceListData.length }),
    "invoice.createRadgivning": radgivningAnswer,
    "billingRun.invoiceSpecification": () => null,
  };
}

/** Rådgivningsfakturan: fel, skapad, eller (standard) ett anrop som aldrig blir klart. */
function radgivningAnswer(): unknown {
  if (radgivningError !== null) return Promise.reject(new Error(radgivningError));
  return radgivningInvoice === null ? never() : { invoice: radgivningInvoice };
}

/** Renderar under båda tRPC-bindningarna och väntar tills första hämtningen är klar. */
async function renderPanel(ui: ReactElement): Promise<FakeTrpcRender> {
  current = renderWithFakeTrpc(ui, handlers());
  if (!runsLoading) await waitFor(() => expect(current?.queryClient.isFetching()).toBe(0));
  return current;
}

/** Indata i anropen till `path` under den senaste renderingen. */
function inputs(path: string): unknown[] {
  return current ? callsTo(current.fake, path) : [];
}

/** Procedurvägarna som invaliderats under den senaste renderingen, från anrop nummer `from`. */
function invalidated(from = 0): string[] {
  return current ? invalidatedPaths({ mock: { calls: current.invalidate.mock.calls.slice(from) } }) : [];
}

vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc }));
vi.mock("@/lib/client/kostnadsrakning/generate-kr-doc", () => ({ generateKrDoc: generateKrDocFn }));
vi.mock("@/lib/client/diagnostics/use-matter-invariants", () => ({ useMatterInvariants: vi.fn() }));
vi.mock("@/lib/client/demo/entity-link", () => ({
  EntityLink: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@/lib/client/demo/generated-doc-cache", () => ({
  hasGeneratedDoc: () => hasDoc,
  openGeneratedDoc: (id: string) => openGeneratedDocFn(id),
}));
const openDocumentFn = vi.fn(async () => "opened-blob" as const);
/** Byråns logga i inställningarna (#1439) — följer med till fakturadialogerna. */
const ORG_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
let billingDialogMeta: unknown;
let verdictOrganization: unknown;
vi.mock("@/lib/client/firma/open-document", () => ({ openDocument: openDocumentFn }));
vi.mock("@/app/matters/[id]/_billing-dialog", () => ({
  BillingDialog: ({ type, meta }: { type: string; meta: unknown }) => { billingDialogMeta = meta; return <div data-testid="billing-dialog">{type}</div>; },
}));
vi.mock("@/app/matters/[id]/_verdict-dialog", () => ({
  VerdictDialog: ({ organization }: { organization?: unknown }) => { verdictOrganization = organization; return <div data-testid="verdict-dialog" />; },
}));
// Modalen själv testas separat — här bara skillnaden stänga vs faktiskt generera (#1121).
vi.mock("@/app/matters/[id]/_kostnadsrakning-modal", () => ({
  KostnadsrakningModal: (p: { onClose: () => void; createRun: () => Promise<string>; isOffentligtUppdrag?: boolean }) => (
    <div data-testid="kr-modal" data-offentligt={String(p.isOffentligtUppdrag)}>
      <button type="button" onClick={p.onClose}>Avbryt modal</button>
      <button type="button" onClick={() => void p.createRun().then((id) => { createdRunId = id; })}>Generera</button>
    </div>
  ),
}));

const baseMatter: MatterContext = {
  matterNumber: "2026-0001",
  title: "Tvist mot motpart",
  contacts: [
    { role: "KLIENT", contact: { name: "Anna Andersson", email: "anna@klient.se" } },
    { role: "DOMSTOL", contact: { name: "Stockholms tingsrätt" } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  createdRunId = null;
  runsData = { runs: [] };
  runsLoading = false;
  documentListData = { documents: [] };
  proposalData = { workValueOre: 0, priorAccontoSumOre: 0, timeEntries: [], expenses: [] };
  invoiceListData = [];
  radgivningError = null;
  radgivningInvoice = null;
  hasDoc = false;
  current = undefined;
  releaseRuns = () => {};
});

describe("BillingPanel — översikt", () => {
  it("renderar rubrik och tomtext utan runs", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={baseMatter} />);
    expect(screen.getByText("Fakturering")).toBeInTheDocument();
    expect(screen.getByText("Inga fakturor ännu.")).toBeInTheDocument();
  });

  it("visar laddtext medan runs hämtas", async () => {
    runsLoading = true;
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={baseMatter} />);
    expect(screen.getByText("Laddar…")).toBeInTheDocument();
  });

  it("faktura-länk för run med invoiceId (EntityLink-stub)", async () => {
    runsData = {
      runs: [
        { id: "r1", type: "ACCONTO", status: "SENT", recipient: "KLIENT", amountOre: 100_000, createdAt: "2026-01-01", invoiceId: "inv-1", invoice: { id: "inv-1", invoiceNumber: "F-1" } },
      ],
    };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={baseMatter} />);
    expect(screen.getByText("F-1")).toBeInTheDocument();
  });

  it("faktura-listan har Kolumner-knappen och kan dölja en kolumn (#1146)", async () => {
    runsData = {
      runs: [
        { id: "r1", type: "ACCONTO", status: "SENT", recipient: "KLIENT", amountOre: 100_000, createdAt: "2026-01-01", invoiceId: "inv-1", invoice: { id: "inv-1", invoiceNumber: "F-1" } },
      ],
    };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={baseMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "Kolumner" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Kolumner" })).getByRole("checkbox", { name: "Mottagare" }));
    expect(screen.queryByRole("columnheader", { name: /Mottagare/ })).not.toBeInTheDocument();
    expect(screen.getByText("F-1")).toBeInTheDocument(); // åtgärdskolumnen kan inte döljas
  });

  it("fristående klientfaktura (rådgivning, ingen run) visas i faktura-listan (#853)", async () => {
    runsData = { runs: [] };
    invoiceListData = [{ id: "inv-rad", invoiceNumber: "F-2026-0012", status: "SENT", amount: 203_250, payments: [] }];
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={baseMatter} />);
    expect(screen.getByText("F-2026-0012")).toBeInTheDocument(); // länk i listan
    expect(screen.getByText(/Skickad/)).toBeInTheDocument(); // status-etikett
  });
});

describe("BillingPanel — summa-vy (#819, #1236: fyra kort)", () => {
  it("visar Upparbetat ofakturerat / Yrkat i kostnadsräkning / Fakturerat / Betalt — inte de gamla korten", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={baseMatter} />);
    expect(screen.getByText("Upparbetat ofakturerat")).toBeInTheDocument();
    expect(screen.getByText("Yrkat i kostnadsräkning")).toBeInTheDocument();
    expect(screen.getByText("Fakturerat")).toBeInTheDocument();
    expect(screen.getByText("Betalt")).toBeInTheDocument();
    expect(screen.queryByText("Aconto fakturerat")).not.toBeInTheDocument();
    expect(screen.queryByText("Väntar på dom")).not.toBeInTheDocument();
  });

  it("Fakturerat = Σ fakturor utom CANCELLED (DRAFT som 'varav'); Betalt = Σ betalningar", async () => {
    invoiceListData = [
      { id: "i1", amount: 250_000, status: "SENT", payments: [{ amount: 100_000 }] },
      { id: "i2", amount: 50_000, status: "PAID", payments: [{ amount: 50_000 }] },
      { id: "i3", amount: 700_000, status: "DRAFT", payments: [] },
      { id: "i4", amount: 888_000, status: "CANCELLED", payments: [] },
    ];
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={baseMatter} />);
    // Fakturerat = 250000 + 50000 + 700000 = 1000000 → "10 000,00"; Betalt = 150000 → "1 500,00".
    // (Brutto-basis + default inkl-läge visar lagrat belopp.)
    expect(screen.getByText(/10\s*000,00/)).toBeInTheDocument();
    expect(screen.getAllByText(/1\s*500,00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/varav skapat, ej skickat/).textContent).toMatch(/7\s*000,00/);
  });
});

describe("BillingPanel — kostnadsräknings-kort (#828)", () => {
  beforeEach(() => {
    runsData = {
      runs: [
        { id: "r3", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", kostnadsrakningStatus: "INSKICKAD", recipient: "DOMSTOL", amountOre: 50_000, createdAt: "2026-03-01" },
      ],
    };
  });

  const verdictMatter = { ...baseMatter, paymentMethod: "OFFENTLIGT_UPPDRAG" as const };

  it("visar KR-kortet + 'Registrera beslut' → öppnar beslut-dialogen; statusen står i Anteckningar (#1221)", async () => {
    runsData = { runs: [{ ...runsData.runs[0]!, reference: "KR-2026-0003" }] };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    expect(screen.getAllByText("KR-2026-0003", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Inskickad — väntar på beslut/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrera beslut" }));
    expect(screen.getByText(/Registrera domstolens beslut/)).toBeInTheDocument();
  });

  it("förordnandemålets avslut står på KR-kortet (#2180)", async () => {
    runsData = { runs: runsData.runs.map((r) => ({ ...r, reference: "KR-2026-0004", forordnandeAvslut: "NEDLAGD" })) };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    expect(screen.getByText("KR-2026-0004 · Förundersökningen lades ned", { exact: false })).toBeInTheDocument();
  });

  it("inskickad KR kan ångras — efter bekräftelse (#1121)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "Ångra kostnadsräkning" }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(inputs("billingRun.voidKostnadsrakning")).toEqual([{ billingRunId: "r3" }]));
    // Bekräftelsen säger att dokumentet tas bort (#1230).
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("kostnadsräkningsdokumentet tas bort"));
    confirmSpy.mockRestore();
  });

  it("efter ångra hämtas dokumentlistorna om — dokumentet är borttaget (#1230)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "Ångra kostnadsräkning" }));
    // Körningarna hämtas om, och båda dokumentlistorna invalideras.
    await waitFor(() => expect(inputs("billingRun.list")).toHaveLength(2));
    expect(invalidated()).toEqual(expect.arrayContaining(["document.list", "document.tree"]));
    vi.restoreAllMocks();
  });

  it("KR-dokumentet länkat till körningen går före ett äldre närmare i tid (#1230)", async () => {
    documentListData = { documents: [
      { id: "doc-old", fileName: "gammal.pdf", documentType: "Kostnadsräkning", createdAt: "2026-03-01" },
      { id: "doc-link", fileName: "lankad.pdf", documentType: "Kostnadsräkning", billingRunId: "r3", createdAt: "2025-01-01" },
    ] };
    hasDoc = true;
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "lankad.pdf" }));
    expect(openGeneratedDocFn).toHaveBeenCalledWith("doc-link");
  });

  it("ångra avbruten i bekräftelsen → inget händer", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "Ångra kostnadsräkning" }));
    expect(inputs("billingRun.voidKostnadsrakning")).toEqual([]);
    confirmSpy.mockRestore();
  });

  it("en ångrad (VOIDED) KR visas inte som aktiv", async () => {
    runsData = { runs: [{ id: "r3", type: "KOSTNADSRAKNING", status: "VOIDED", kostnadsrakningStatus: "INSKICKAD", recipient: "DOMSTOL", amountOre: 50_000, createdAt: "2026-03-01" }] };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    expect(screen.queryByRole("button", { name: "Registrera beslut" })).not.toBeInTheDocument();
  });

  it("BESLUTAD KR visar 'Skapa faktura' + 'Överklaga prutning'", async () => {
    runsData = { runs: [{ id: "r3", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", kostnadsrakningStatus: "BESLUTAD", recipient: "DOMSTOL", amountOre: 50_000, awardedOre: 40_000, createdAt: "2026-03-01" }] };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    // Dömt belopp + status loggas som anteckning (#1221), inte i kortet.
    expect(screen.queryByText(/Dömt belopp/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skapa faktura" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Överklaga prutning" })).toBeInTheDocument();
    // Efter domstolens beslut går den inte att ångra (#1121).
    expect(screen.queryByRole("button", { name: "Ångra kostnadsräkning" })).not.toBeInTheDocument();
  });

  it("'Skapa faktura' ger domstolsfakturan byråns namn, org.nr och logga (#1439)", async () => {
    runsData = { runs: [{ id: "r3", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", kostnadsrakningStatus: "BESLUTAD", recipient: "DOMSTOL", amountOre: 50_000, awardedOre: 40_000, createdAt: "2026-03-01" }] };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "Skapa faktura" }));
    expect(screen.getByTestId("verdict-dialog")).toBeInTheDocument();
    expect(verdictOrganization).toEqual({ organizationName: "Byrå AB", organizationOrgNumber: "556677-8899", organizationLogo: ORG_LOGO });
  });

  it("öppnar KR-dokumentet ur blob-cachen när det finns", async () => {
    documentListData = { documents: [{ id: "doc-1", fileName: "kostnadsrakning.docx", documentType: "Kostnadsräkning", createdAt: "2026-03-01" }] };
    hasDoc = true;
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "kostnadsrakning.docx" }));
    expect(openGeneratedDocFn).toHaveBeenCalledWith("doc-1");
  });

  it("seedat/server-dokument (ej i blob-cachen) → går server-vägen, inte blob-cachen (#839)", async () => {
    documentListData = { documents: [{ id: "doc-1", fileName: "kostnadsrakning.docx", documentType: "Kostnadsräkning", storagePath: "documents/content/doc-1.html", createdAt: "2026-03-01" }] };
    hasDoc = false;
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "kostnadsrakning.docx" }));
    // Faller inte tillbaka på blob-cachen → öppnas via openDocument (downloadContent).
    expect(openGeneratedDocFn).not.toHaveBeenCalled();
    await waitFor(() => expect(openDocumentFn).toHaveBeenCalled());
  });

  it("KOSTNADSRAKNING-raden i runs-listan länkar till KR-dokumentet (#843)", async () => {
    // FAKTURERAD → inget aktivt KR-kort; länken ska finnas på själva raden.
    runsData = { runs: [{ id: "r9", type: "KOSTNADSRAKNING", status: "SENT", kostnadsrakningStatus: "FAKTURERAD", recipient: "DOMSTOL", amountOre: 50_000, createdAt: "2026-03-01" }] };
    documentListData = { documents: [{ id: "doc-9", fileName: "kostnadsrakning.docx", documentType: "Kostnadsräkning", storagePath: "documents/content/doc-9.html", createdAt: "2026-03-01" }] };
    hasDoc = false;
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={verdictMatter} />);
    fireEvent.click(screen.getByRole("button", { name: "Kostnadsräkning" }));
    await waitFor(() => expect(openDocumentFn).toHaveBeenCalled());
  });
});

describe("BillingPanel — Skapa-faktura-menyn (flödesmodellen)", () => {
  it("PRIVAT-default: bara 'Faktura till klient' → öppnar FINAL-dialogen", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    fireEvent.click(screen.getByRole("button", { name: "Faktura till klient" }));
    expect(screen.getByTestId("billing-dialog")).toHaveTextContent("FINAL");
    // Byråns namn, org.nr och logga följer med till fakturadokumentet (#1439).
    expect(billingDialogMeta).toMatchObject({ organizationName: "Byrå AB", organizationOrgNumber: "556677-8899", organizationLogo: ORG_LOGO });
  });

  it("RATTSSKYDD: aconto + faktura till försäkring", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSSKYDD" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    expect(screen.getByRole("button", { name: "Aconto till klient" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Faktura till försäkring" })).toBeInTheDocument();
  });

  it("OFFENTLIGT_UPPDRAG: kostnadsräkning → öppnar KR-modalen", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "OFFENTLIGT_UPPDRAG" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    fireEvent.click(screen.getByRole("button", { name: "Kostnadsräkning till domstol" }));
    expect(screen.getByTestId("kr-modal")).toBeInTheDocument();
    // Förordnandetaxan kan väljas i ett offentligt uppdrag (#1858).
    expect(screen.getByTestId("kr-modal")).toHaveAttribute("data-offentligt", "true");
  });

  it("att STÄNGA KR-modalen skapar ingen kostnadsräkning — bara att generera gör det (#1121)", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "OFFENTLIGT_UPPDRAG" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    fireEvent.click(screen.getByRole("button", { name: "Kostnadsräkning till domstol" }));
    fireEvent.click(screen.getByRole("button", { name: "Avbryt modal" }));
    expect(inputs("billingRun.createKostnadsrakning")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    fireEvent.click(screen.getByRole("button", { name: "Kostnadsräkning till domstol" }));
    fireEvent.click(screen.getByRole("button", { name: "Generera" }));
    // Körningens id går tillbaka till modalen, som länkar dokumentet till den (#1230).
    await waitFor(() => expect(createdRunId).toBe("run-new"));
    expect(inputs("billingRun.createKostnadsrakning")).toEqual([{ matterId: "m1" }]);
  });

  it("PENDING: aconto och faktura till klient som PRIVAT, inget 'Välj betalningssätt' (#1730)", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    expect(screen.getByRole("button", { name: "Aconto till klient" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Faktura till klient" })).toBeInTheDocument();
    expect(screen.queryByText(/Välj betalningssätt/)).not.toBeInTheDocument();
  });

  it("RATTSHJALP: kostnadsräkning till domstol (ej direktfaktura) — öppnar rättshjälps-dialogen", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    // Domstolen får en kostnadsräkning — INTE "Faktura till myndighet" (#806).
    expect(screen.queryByRole("button", { name: /Faktura till myndighet/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kostnadsräkning till domstol" }));
    // Rättshjälps-dialogen (egen, ej brottmåls-KR-modalen) bekräftar inskicket.
    expect(screen.getByRole("button", { name: "Skapa kostnadsräkning" })).toBeInTheDocument();
    expect(screen.queryByTestId("kr-modal")).not.toBeInTheDocument();
  });

  it("RATTSHJALP: KR-dokumentet byggs på körningens EGNA poster + rådgivningsnotisen (#1205)", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP", radgivningBetaldAt: "2026-01-05" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    fireEvent.click(screen.getByRole("button", { name: "Kostnadsräkning till domstol" }));
    // Knappen väntar tills posterna har hämtats.
    await waitFor(() => expect(screen.getByRole("button", { name: "Skapa kostnadsräkning" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Skapa kostnadsräkning" }));
    await waitFor(() => expect(generateKrDocFn).toHaveBeenCalled());
    expect(generateKrDocFn).toHaveBeenCalledWith(expect.objectContaining({
      ownBillingRunId: "run-new", timeEntries: [],
      meta: expect.objectContaining({ radgivningPaid: true }),
    }));
  });
});

describe("BillingPanel — menyns öppna läge ägs av panelen (#1853)", () => {
  it("knappen öppnar och stänger menyn, och ett klick utanför stänger den", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} />);
    const knapp = screen.getByRole("button", { name: "+ Skapa faktura" });
    fireEvent.click(knapp);
    expect(screen.getByRole("button", { name: "Faktura till klient" })).toBeInTheDocument();
    fireEvent.click(knapp);
    expect(screen.queryByRole("button", { name: "Faktura till klient" })).not.toBeInTheDocument();
    fireEvent.click(knapp);
    const overlay = document.querySelector(".fixed.inset-0");
    expect(overlay).not.toBeNull();
    if (overlay) fireEvent.click(overlay);
    expect(screen.queryByRole("button", { name: "Faktura till klient" })).not.toBeInTheDocument();
  });
});

describe("BillingPanel — genvägen fakturera nu (#1853)", () => {
  const m1 = asId<"MatterId">("m1");

  it("rättshjälp: begäran öppnar dialogen Aconto till klient och meddelar en gång", async () => {
    const done = vi.fn();
    const { rerender } = await renderPanel(<BillingPanel matterId={m1} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP", radgivningBetaldAt: "2026-01-01" }} shortcutRequested onShortcutDone={done} />);
    expect(screen.getByTestId("billing-dialog")).toHaveTextContent("ACCONTO");
    rerender(<BillingPanel matterId={m1} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP", radgivningBetaldAt: "2026-01-01" }} shortcutRequested onShortcutDone={done} />);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("privat ärende: begäran öppnar menyn + Skapa faktura", async () => {
    const done = vi.fn();
    await renderPanel(<BillingPanel matterId={m1} matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} shortcutRequested onShortcutDone={done} />);
    expect(screen.getByRole("button", { name: "Faktura till klient" })).toBeInTheDocument();
    expect(screen.queryByTestId("billing-dialog")).not.toBeInTheDocument();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("inget öppnas innan körningarna har laddats", async () => {
    runsLoading = true;
    const done = vi.fn();
    const matter = { ...baseMatter, paymentMethod: "PRIVAT" as const };
    await renderPanel(<BillingPanel matterId={m1} matter={matter} shortcutRequested onShortcutDone={done} />);
    expect(screen.queryByRole("button", { name: "Faktura till klient" })).not.toBeInTheDocument();
    expect(done).not.toHaveBeenCalled();
    releaseRuns();
    expect(await screen.findByRole("button", { name: "Faktura till klient" })).toBeInTheDocument();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("slutreglerat ärende: inget öppnas, men begäran meddelas ändå en gång", async () => {
    runsData = { runs: [{ id: "r1", type: "FINAL", status: "SENT", recipient: "FORSAKRING", amountOre: 100, createdAt: "2026-01-01" }] };
    const done = vi.fn();
    await renderPanel(<BillingPanel matterId={m1} matter={{ ...baseMatter, paymentMethod: "RATTSSKYDD" }} shortcutRequested onShortcutDone={done} />);
    expect(screen.queryByTestId("billing-dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Skapa faktura" })).not.toBeInTheDocument();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("utan begäran öppnas inget", async () => {
    const done = vi.fn();
    await renderPanel(<BillingPanel matterId={m1} matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} onShortcutDone={done} />);
    expect(screen.queryByRole("button", { name: "Faktura till klient" })).not.toBeInTheDocument();
    expect(done).not.toHaveBeenCalled();
  });

  it("en ny begäran efter en avslutad hanteras igen, utan onShortcutDone", async () => {
    const matter = { ...baseMatter, paymentMethod: "PRIVAT" as const };
    const { rerender } = await renderPanel(<BillingPanel matterId={m1} matter={matter} shortcutRequested />);
    expect(screen.getByRole("button", { name: "Faktura till klient" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    rerender(<BillingPanel matterId={m1} matter={matter} shortcutRequested={false} />);
    expect(screen.queryByRole("button", { name: "Faktura till klient" })).not.toBeInTheDocument();
    rerender(<BillingPanel matterId={m1} matter={matter} shortcutRequested />);
    expect(screen.getByRole("button", { name: "Faktura till klient" })).toBeInTheDocument();
  });
});

describe("BillingPanel — rådgivnings-banner (rättshjälp)", () => {
  it("RATTSHJALP utan registrerad rådgivning → auto-skapar (#839)", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP" }} />);
    // Ingen informationsruta längre (#1221) — händelsen blir en anteckning.
    expect(screen.queryByText(/Rådgivningstimme \(rättshjälp\)/)).not.toBeInTheDocument();
    // Ingen manuell knapp längre — fakturan skapas automatiskt via useEffect.
    expect(screen.queryByRole("button", { name: "Registrera betald" })).not.toBeInTheDocument();
    await waitFor(() => expect(inputs("invoice.createRadgivning")).toEqual([{ matterId: "m1" }]));
  });

  it("RATTSHJALP med registrerad rådgivning → visar registrerad, auto-skapar inte (#851)", async () => {
    // Rådgivningen är nu ett ACCONTO som syns i faktura-listan (RunsList), inte
    // en länk i banderollen.
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP", radgivningBetaldAt: "2026-01-05" }} />);
    expect(screen.queryByText(/Fakturerad/)).not.toBeInTheDocument();
    expect(inputs("invoice.createRadgivning")).toEqual([]);
  });

  it("skapad rådgivningsfaktura får sitt dokument, och panelen hämtar om (#845)", async () => {
    radgivningInvoice = { id: "inv-r", amount: 125_000, invoiceNumber: "2026-1" };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP" }} />);
    await waitFor(() => expect(inputs("billingRun.list")).toHaveLength(2));
    expect(inputs("billingRun.invoiceSpecification")).toEqual([{ matterId: "m1", invoiceId: "inv-r" }]);
    expect(inputs("document.register")).toEqual([expect.objectContaining({ matterId: "m1", invoiceId: "inv-r", kinds: ["FAKTURA"] })]);
    expect(persistGeneratedDoc).toHaveBeenCalled();
    expect(invalidated()).toEqual(expect.arrayContaining(["document.list", "document.tree {\"matterId\":\"m1\"}", "serviceNote.list"]));
  });

  it("misslyckad auto-skapning syns som fel — det enda juristen behöver agera på (#1221)", async () => {
    radgivningError = "nätverksfel";
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Rådgivningsfakturan kunde inte skapas: nätverksfel");
  });

  it("Rättshjälpsavgift över tid: acontoraderna är toppjusterade, slutliga beslutet inte (#1753)", async () => {
    runsData = { runs: [
      { id: "a1", type: "ACCONTO", status: "INVOICED", recipient: "KLIENT", amountOre: 10_000, createdAt: "2026-01-05", clientShareBips: 2000 },
      { id: "a2", type: "ACCONTO", status: "INVOICED", recipient: "KLIENT", amountOre: 10_000, createdAt: "2026-03-05", clientShareBips: 4000 },
    ] };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")}
      matter={{ ...baseMatter, paymentMethod: "RATTSHJALP", radgivningBetaldAt: "2026-01-05", clientShareBips: 3000 }} />);
    const card = screen.getByText("Rättshjälpsavgift över tid").parentElement;
    if (!card) throw new Error("kortet Rättshjälpsavgift över tid saknas");
    const schedule = within(card);
    expect(schedule.getByText("20 %").closest("tr")).toHaveClass("align-top");
    expect(schedule.getByText("40 %").closest("tr")).toHaveClass("align-top");
    expect(schedule.getByText(/Slutligt myndighetsbeslut/).closest("tr")).not.toHaveClass("align-top");
  });

  it("självrisk-aconto-hint visas när självrisken nått tröskeln, och knappen öppnar Aconto till klient (#854, #1852)", async () => {
    proposalData = { ...proposalData, workValueOre: 800_000 }; // 20 % = 1 600 kr ≥ 1 500 kr (tröskel)
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP", radgivningBetaldAt: "2026-01-05" }} />);
    expect(screen.getByText(/Klientens självrisk har nått/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aconto till klient" }));
    expect(screen.getByTestId("billing-dialog")).toHaveTextContent("ACCONTO");
  });

  it("ingen hint under tröskeln", async () => {
    proposalData = { ...proposalData, workValueOre: 500_000 }; // 20 % = 1 000 kr < 1 500 kr
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSHJALP", radgivningBetaldAt: "2026-01-05" }} />);
    expect(screen.queryByText(/Klientens självrisk/)).not.toBeInTheDocument();
  });

  it("icke-rättshjälp → ingen rådgivnings-banner", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} />);
    expect(screen.queryByText(/Rådgivningstimme/)).not.toBeInTheDocument();
  });
});

describe("BillingPanel — informationsrutorna är borta (#1221)", () => {
  it("slutreglerat ärende: ingen lägestext i rubriken", async () => {
    runsData = { runs: [{ id: "f1", type: "FINAL", status: "SENT", recipient: "KLIENT", amountOre: 1000, createdAt: "2026-03-01" }] };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} />);
    expect(screen.queryByText(/Ärendet är slutreglerat/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Inga faktureringsåtgärder/)).not.toBeInTheDocument();
  });

  it("nekat rättsskydd: ingen lägestext i rubriken", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSSKYDD", rattsskyddNekadAt: "2026-02-01" }} />);
    expect(screen.queryByText(/Rättsskydd nekat/)).not.toBeInTheDocument();
  });

  it("försäkringens prutning: rutan visas tills fakturan är betald", async () => {
    const payer = { id: "p1", type: "FINAL", status: "SENT", recipient: "FORSAKRING", amountOre: 1000, createdAt: "2026-03-01" };
    runsData = { runs: [payer] };
    const { unmount } = await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSSKYDD" }} />);
    expect(screen.getByRole("button", { name: "Registrera prutning" })).toBeInTheDocument();
    unmount();
    runsData = { runs: [{ ...payer, invoice: { id: "i1", status: "PAID" } }] };
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "RATTSSKYDD" }} />);
    expect(screen.queryByRole("button", { name: "Registrera prutning" })).not.toBeInTheDocument();
  });

  it("efter en faktureringshändelse hämtas Anteckningar och Frister om", async () => {
    await renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "OFFENTLIGT_UPPDRAG" }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Skapa faktura" }));
    fireEvent.click(screen.getByRole("button", { name: "Kostnadsräkning till domstol" }));
    const before = current?.invalidate.mock.calls.length ?? 0;
    fireEvent.click(screen.getByRole("button", { name: "Generera" }));
    await waitFor(() => expect(invalidated(before)).toEqual([
      "billingRun.proposal {\"matterId\":\"m1\"}", "expense.list {\"matterId\":\"m1\"}", "invoice.list",
      "serviceNote.list", "timeEntry.list {\"matterId\":\"m1\"}", "watchlist.list",
    ]));
  });
});

describe("BillingPanel — Fakturering-listan döljer annullerade och krediteringar (#1523)", () => {
  const run = (id: string, type: string, status: string): BillingRunRow => ({
    id, type, status, recipient: "KLIENT", amountOre: 1000, createdAt: "2026-03-01",
    invoiceId: `inv-${id}`, invoice: { id: `inv-${id}`, invoiceNumber: `F-${id}` },
  });
  const invoice = (id: string, status: string, invoiceType: string): InvoiceRow => ({
    id, amount: 1000, status, invoiceType, payments: [], invoiceNumber: `F-${id}`,
  });
  const panel = () => renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} />);

  beforeEach(() => {
    runsData = { runs: [run("r1", "ACCONTO", "SENT"), run("r2", "KOSTNADSRAKNING", "VOIDED"), run("r3", "CREDIT", "SENT")] };
    invoiceListData = [invoice("s1", "SENT", "STANDARD"), invoice("s2", "CANCELLED", "STANDARD"), invoice("s3", "SENT", "CREDIT")];
  });

  it("annullerade körningar, krediteringar, annullerade fakturor och kreditfakturor är dolda från början", async () => {
    await panel();
    expect(screen.getByText("F-r1")).toBeInTheDocument();
    expect(screen.getByText("F-s1")).toBeInTheDocument();
    for (const hidden of ["F-r2", "F-r3", "F-s2", "F-s3"]) expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa annullerade (4)" })).toBeInTheDocument();
  });

  it("knappen tar fram dem med sin status och döljer dem igen", async () => {
    await panel();
    fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (4)" }));
    for (const shown of ["F-r2", "F-r3", "F-s2", "F-s3"]) expect(screen.getByText(shown)).toBeInTheDocument();
    expect(screen.getByText("Kreditering")).toBeInTheDocument();
    expect(screen.getAllByText("Annullerad").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Dölj annullerade" }));
    expect(screen.queryByText("F-r2")).not.toBeInTheDocument();
  });

  it("ingen knapp när inget är dolt", async () => {
    runsData = { runs: [run("r1", "ACCONTO", "SENT")] };
    invoiceListData = [];
    await panel();
    expect(screen.getByText("F-r1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /annullerade/ })).not.toBeInTheDocument();
  });

  it("bara dolda rader: tom tabell med knappen, inte 'Inga fakturor ännu.'", async () => {
    runsData = { runs: [run("r2", "KOSTNADSRAKNING", "VOIDED")] };
    invoiceListData = [];
    await panel();
    expect(screen.queryByText("Inga fakturor ännu.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa annullerade (1)" })).toBeInTheDocument();
  });
});

describe("BillingPanel — Fakturering-listan visar kostnadsräkningens livscykel (#1860)", () => {
  const kr = (over: Partial<BillingRunRow>): BillingRunRow => ({
    id: "kr1", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", recipient: "DOMSTOL",
    amountOre: 50_000, createdAt: "2026-03-01", reference: "KR-2026-0001", ...over,
  });
  /** Statuskolumnen (fjärde cellen) på listraden som bär referensen `ref`
   *  (en aktiv KR visar referensen också i sitt kort, utanför tabellen). */
  const statusCell = (ref = "KR-2026-0001"): string | null => {
    const row = screen.getAllByText(ref).map((el) => el.closest("tr")).find((tr) => tr != null);
    return row ? within(row).getAllByRole("cell")[3]?.textContent ?? null : null;
  };
  const panel = () => renderPanel(<BillingPanel matterId={asId<"MatterId">("m1")} matter={{ ...baseMatter, paymentMethod: "PRIVAT" }} />);

  beforeEach(() => { invoiceListData = []; });

  it.each([
    ["BESLUTAD", "PENDING_VERDICT", "Beslutad"],
    ["OVERKLAGAD", "PENDING_VERDICT", "Överklagad"],
    ["FAKTURERAD", "SENT", "Fakturerad"],
    ["INSKICKAD", "PENDING_VERDICT", "Väntar på dom"],
  ])("KR i %s (körning %s) visar %s", async (krStatus, status, label) => {
    runsData = { runs: [kr({ kostnadsrakningStatus: krStatus, status })] };
    await panel();
    expect(statusCell()).toBe(label);
  });

  it("äldre KR utan livsstatus och utan faktura visar Väntar på dom", async () => {
    runsData = { runs: [kr({ kostnadsrakningStatus: null })] };
    await panel();
    expect(statusCell()).toBe("Väntar på dom");
  });

  it("en ångrad KR visar Annullerad och är dold från början", async () => {
    runsData = { runs: [kr({ kostnadsrakningStatus: "INSKICKAD", status: "VOIDED" })] };
    await panel();
    expect(screen.queryByText("KR-2026-0001")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Visa annullerade (1)" }));
    expect(statusCell()).toBe("Annullerad");
  });

  it("aconto och slutfaktura visar körningens status som förut", async () => {
    runsData = { runs: [
      { id: "a1", type: "ACCONTO", status: "SENT", recipient: "KLIENT", amountOre: 1000, createdAt: "2026-03-01", invoiceId: "inv-a1", invoice: { id: "inv-a1", invoiceNumber: "F-a1" } },
      { id: "f1", type: "FINAL", status: "DRAFT", recipient: "KLIENT", amountOre: 1000, createdAt: "2026-03-02", invoiceId: "inv-f1", invoice: { id: "inv-f1", invoiceNumber: "F-f1" } },
    ] };
    await panel();
    expect(statusCell("F-a1")).toBe("Skickad");
    expect(statusCell("F-f1")).toBe("Utkast");
  });
});
