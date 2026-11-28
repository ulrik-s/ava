/**
 * Test för MatterDetailPage — den största sidan i appen.
 *
 * Alla tRPC-anrop går genom en fejkad länk (`renderWithFakeTrpc`, ADR 0041);
 * tunga barnkomponenter mockas som platshållare.
 */

import { act, screen, within, fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import { Suspense } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import MatterDetailPage from "@/app/matters/[id]/_client";
import { callsTo, DATA_TABLE_HANDLERS, renderWithFakeTrpc } from "../../../../helpers/trpc-both-fake";
import type { FakeTrpcLink, TrpcHandlers } from "../../../../helpers/trpc-fake";

/** `matter.getById`: ärendet, eller "laddar" (svarar aldrig) / ett fel. */
const matterQuery: { data: Record<string, unknown> | undefined; isLoading: boolean; error: Error | null } = {
  data: undefined,
  isLoading: false,
  error: null,
};
const timeQuery: { data: Record<string, unknown> } = { data: { entries: [], totalMinutes: 0 } };
const expenseQuery: { data: Record<string, unknown> } = { data: { expenses: [], totalAmount: 0 } };
const templatesQuery: { data: undefined | Array<{ id: string; name: string; category: string | null; content?: string }> } = { data: undefined };
const receivablesQuery: { data: unknown[] } = { data: [] };
// Upparbetat mot taket — styr takvarningen (#793/#1520).
const coverageQuery = { data: { billableMinutes: 0, billableValueOre: 0 } };

function matterResponse(): unknown {
  if (matterQuery.isLoading) return new Promise(() => {});
  if (matterQuery.error) throw matterQuery.error;
  return matterQuery.data;
}

/** Mallarna; utan värde svarar vägen inte (som en fråga utan data). */
function templatesResponse(): unknown {
  if (templatesQuery.data === undefined) throw new Error("inga mallar");
  return templatesQuery.data;
}

const ok = () => ({});
/** Svaren sidan och dess paneler läser; vägar utan svar ger ett fel (frågan saknar data). */
const HANDLERS: TrpcHandlers = {
  ...DATA_TABLE_HANDLERS,
  "matter.getById": matterResponse,
  "matter.coverageUsage": () => coverageQuery.data,
  "matter.removeContact": ok,
  // Ärendena en tidspost kan flyttas till (#2042).
  "matter.list": () => ({ matters: [], total: 0, pages: 0 }),
  // WatchSection: ärendets övriga signaler (#1162/#1167).
  "watchlist.list": () => ({ items: [] }),
  "task.listForMatter": () => [],
  "timeEntry.list": () => timeQuery.data,
  "timeEntry.create": (input) => ({ id: "te-ny", ...Object(input) }),
  "expense.list": () => expenseQuery.data,
  "expense.create": (input) => ({ id: "e-ny", ...Object(input) }),
  "expense.delete": ok,
  "contacts.list": () => ({ contacts: [] }),
  "contacts.search": () => ({ contacts: [] }),
  "documentTemplate.list": templatesResponse,
  // useMatterInvariants (diagnostik) och useEagerCacheMatterDocuments (ADR 0028 §4a).
  "document.list": () => ({ documents: [] }),
  "document.tree": () => ({ documents: [] }),
  "organization.getSettings": () => ({}),
  // Mallkontextens kontor (#2118).
  "organization.listOffices": () => [],
  "billingRun.list": () => ({ runs: [] }),
  // #819: BillingPanel → BillingSummary summerar Fakturerat/Betalt ur list.
  "invoice.list": () => [],
  "calendar.listForMatter": () => [],
  "expectedReceivable.list": () => receivablesQuery.data,
  "serviceNote.list": () => [],
  "user.current": () => ({ id: "u1", name: "Anna", email: "anna@firma.local", role: "LAWYER" }),
  "user.list": () => ({ users: [] }),
};

/** Den senaste renderingens länk. */
let fake: FakeTrpcLink;

/** Indata till anropen av `path`, som objekt. */
const inputsTo = (path: string): Array<Record<string, unknown>> =>
  callsTo(fake, path).map((i) => (typeof i === "object" && i !== null ? { ...i } : {}));

// Navigation: kalender-sektionen (tillagd denna session) använder
// useRouter/Link → måste mockas annars "app router not mounted".
// `?fakturera=1` (#1854): adressens parametrar och router.replace styrs per test.
const navigation = { search: new URLSearchParams(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace, refresh: vi.fn() }),
  usePathname: () => "/matters/m1",
  useSearchParams: () => navigation.search,
}));
vi.mock("@/lib/client/demo/use-route-id", () => ({ useRouteId: () => "m1" }));
// Avsluta och Återöppna går genom den delade hooken (#2100); frågan och anropen testas i dess test.
const statusActions = { close: vi.fn(), reopen: vi.fn(), keepActive: vi.fn(), isPending: false };
vi.mock("@/components/matter/use-matter-status-actions", () => ({ useMatterStatusActions: () => statusActions }));

// Dockytan (#1185) kräver en riktig webbläsarlayout — här renderas alla
// paneler efter varandra så testerna kan granska innehållet.
// Dockytan (#1184) kräver en riktig webbläsarlayout — här renderas huvudet och
// alla paneler efter varandra, synkront, så testerna kan granska innehållet.
// Den aktiva panelen sidan ber om (#1851/#1854) sparas för testerna.
const panelPage: { activePanel: string | null | undefined } = { activePanel: undefined };
vi.mock("@/components/layout/panel-page", () => ({
  PanelPage: ({ header, panels, activePanel }: { header: React.ReactNode; activePanel?: string | null; panels: ReadonlyArray<{ id: string; render: () => React.ReactNode }> }) => {
    panelPage.activePanel = activePanel;
    return <>{header}{panels.map((p) => <div key={p.id} data-panel={p.id}>{p.render()}</div>)}</>;
  },
}));

// Tunga barnkomponenter — mocka som platshållare
vi.mock("@/components/documents/document-browser", () => ({
  DocumentBrowser: () => <div data-testid="doc-browser" />,
}));
vi.mock("@/components/matter/suggestions-panel", () => ({
  SuggestionsPanel: () => <div data-testid="suggestions" />,
}));
vi.mock("@/components/matter/events-panel", () => ({
  EventsPanel: () => <div data-testid="events" />,
}));

const M = {
  id: "m1",
  matterNumber: "2026-0001",
  title: "Bodelning Lindström",
  status: "ACTIVE",
  matterType: "Familjerätt",
  description: "En bodelning",
  paymentMethod: "RATTSHJALP",
  paymentMethodNote: null,
  paymentMethodDecidedAt: null,
  contacts: [
    {
      id: "mc1",
      role: "KLIENT",
      contact: { id: "c1", name: "Anna", contactType: "PERSON", personalNumber: null, orgNumber: null },
    },
  ],
  _count: { documents: 0, timeEntries: 0, emails: 0 },
};


const renderPage = (): RenderResult => {
  const view = renderWithFakeTrpc(
    <Suspense fallback={<div>laddar</div>}>
      <MatterDetailPage id="m1" />
    </Suspense>,
    HANDLERS,
  );
  fake = view.fake;
  return view;
};

/** Låter länkens svar och React Querys notiser landa. */
async function settle(): Promise<void> {
  await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.search = new URLSearchParams();
  panelPage.activePanel = undefined;
  matterQuery.data = M;
  matterQuery.isLoading = false;
  matterQuery.error = null;
  coverageQuery.data = { billableMinutes: 0, billableValueOre: 0 };
  timeQuery.data = { entries: [], totalMinutes: 0 };
  expenseQuery.data = { expenses: [], totalAmount: 0 };
  templatesQuery.data = undefined;
  receivablesQuery.data = [];
});

describe("MatterDetailPage", () => {
  describe("?fakturera=1 öppnar faktureringen (#1854)", () => {
    it("gör Fakturering aktiv, öppnar Aconto till klient och tar bort parametern en gång", async () => {
      navigation.search = new URLSearchParams("id=m1&fakturera=1");
      const { rerender } = renderPage();
      await settle();
      await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/matters/__shell__/?id=m1"));
      expect(panelPage.activePanel).toBe("billing");
      expect(screen.getAllByText(/Aconto till klient/).length).toBeGreaterThan(0);
      rerender(<Suspense fallback={<div>laddar</div>}><MatterDetailPage id="m1" /></Suspense>);
      expect(navigation.replace).toHaveBeenCalledTimes(1);
    });

    it("utan parametern: ingen aktiv panel och adressen rörs inte", async () => {
      renderPage();
      await waitFor(() => expect(screen.getByTestId("matter-header")).toBeInTheDocument());
      expect(panelPage.activePanel).toBeNull();
      expect(navigation.replace).not.toHaveBeenCalled();
      expect(screen.queryByText(/Aconto till klient/)).not.toBeInTheDocument();
    });
  });

  it("visar laddartext under loading", async () => {
    matterQuery.isLoading = true;
    matterQuery.data = undefined;
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Laddar\.\.\./i)).toBeInTheDocument(),
    );
  });

  it("visar fel när matter.error är satt", async () => {
    matterQuery.error = new Error("Saknas");
    renderPage();
    await waitFor(() => expect(screen.getByText(/Saknas/)).toBeInTheDocument());
  });

  it("målnummer visas som text även i icke-domstolsärende (#1134, #1566)", async () => {
    matterQuery.data = { ...M, courtCaseNumber: "T 3288-26" };
    renderPage();
    await waitFor(() => expect(screen.getByTestId("matter-court-case-number")).toHaveTextContent("Målnummer: T 3288-26"));
    expect(screen.queryByText(/Domstolsbetalningar/)).not.toBeInTheDocument();
  });

  it("ärendehuvudet är en läsvy: inga textrutor, saknade uppgifter med streck (#1566)", async () => {
    matterQuery.data = { ...M, matterType: "", description: null };
    renderPage();
    const header = await waitFor(() => screen.getByTestId("matter-header"));
    expect(within(header).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(header).getByTestId("matter-type")).toHaveTextContent("Ärendetyp: –");
    expect(within(header).getByTestId("matter-court-case-number")).toHaveTextContent("Målnummer: –");
    expect(within(header).getByTestId("matter-description")).toHaveTextContent("Beskrivning: –");
    expect(within(header).queryByRole("button", { name: /^Spara/ })).not.toBeInTheDocument();
  });

  it("huvudets andra rad: betalningssätt och målnummer på samma rad, Ändra sist, ingen Ansvarig (#1848)", async () => {
    matterQuery.data = { ...M, courtCaseNumber: "T 2-26" };
    renderPage();
    const header = await waitFor(() => screen.getByTestId("matter-header"));
    const row = within(header).getByTestId("matter-payment-line").parentElement;
    if (!row) throw new Error("klientraden saknas");
    expect(within(row).getByTestId("matter-court-case-number")).toHaveTextContent("Målnummer: T 2-26");
    expect(within(row).getByTestId("matter-description")).toHaveTextContent("Beskrivning: En bodelning");
    expect(row.lastElementChild).toBe(within(row).getByRole("button", { name: "Ändra ärende" }));
    expect(within(header).queryByText(/Ansvarig/)).not.toBeInTheDocument();
  });

  it("tidigare målnummer visas i ärendehuvudet när det finns (#1510)", async () => {
    matterQuery.data = { ...M, courtCaseNumber: "T 2-26", previousCourtCaseNumber: "T 1-26" };
    renderPage();
    await waitFor(() => expect(screen.getByText("Tidigare målnr")).toBeInTheDocument());
    expect(screen.getByText("T 1-26")).toBeInTheDocument();
  });

  it("försäkringsreferensen visas bara med försäkringsbolag som kontakt (#1511)", async () => {
    const first = renderPage();
    await waitFor(() => expect(screen.getByTestId("matter-court-case-number")).toBeInTheDocument());
    expect(screen.queryByTestId("matter-insurance-reference")).not.toBeInTheDocument();
    first.unmount();
    const insurer = { id: "mc2", role: "FORSAKRINGSBOLAG", contact: { id: "c2", name: "Bolaget", contactType: "INSURANCE_COMPANY", personalNumber: null, orgNumber: null } };
    matterQuery.data = { ...M, contacts: [...M.contacts, insurer], insuranceReference: "SK-1" };
    renderPage();
    await waitFor(() => expect(screen.getByTestId("matter-insurance-reference")).toHaveTextContent("Försäkringsreferens: SK-1"));
  });

  it("försäkringsreferensen döljs när försäkringsbolaget bara är motpart (#1532)", async () => {
    const adverse = { id: "mc2", role: "MOTPART", contact: { id: "c2", name: "Bolaget", contactType: "INSURANCE_COMPANY", personalNumber: null, orgNumber: null } };
    matterQuery.data = { ...M, contacts: [...M.contacts, adverse], insuranceReference: "SK-1" };
    renderPage();
    await waitFor(() => expect(screen.getByTestId("matter-court-case-number")).toBeInTheDocument());
    expect(screen.queryByTestId("matter-insurance-reference")).not.toBeInTheDocument();
  });

  it("ärendehuvudet visar betalningssätt, försäkringsbolag och klientens andel (#1518)", async () => {
    const line = () => screen.getByTestId("matter-payment-line");
    const first = renderPage();
    await waitFor(() => expect(line()).toHaveTextContent(/^· Rättshjälp$/));
    first.unmount();

    const insurer = { id: "mc2", role: "FORSAKRINGSBOLAG", contact: { id: "c2", name: "Bolaget", contactType: "INSURANCE_COMPANY", personalNumber: null, orgNumber: null } };
    matterQuery.data = { ...M, paymentMethod: "RATTSSKYDD", clientShareBips: 2000, contacts: [...M.contacts, insurer] };
    const rs = renderPage();
    await waitFor(() => expect(line()).toHaveTextContent("· Rättsskydd · Bolaget · klienten betalar 20 %"));
    rs.unmount();

    // Försäkringsbolag som motpart visas inte som rättsskyddsbolaget.
    matterQuery.data = { ...M, paymentMethod: "RATTSSKYDD", clientShareBips: 2000, contacts: [...M.contacts, { ...insurer, role: "MOTPART" }] };
    const adverse = renderPage();
    await waitFor(() => expect(line()).toHaveTextContent(/^· Rättsskydd · klienten betalar 20 %$/));
    adverse.unmount();

    // Utan klient och ärendetyp: "Ärendetyp: –" står före, så avgränsaren är kvar (#1566).
    matterQuery.data = { ...M, contacts: [], matterType: null, clientShareBips: 1000 };
    renderPage();
    await waitFor(() => expect(line()).toHaveTextContent(/^· Rättshjälp · klienten betalar 10 %$/));
  });

  describe("takvarningen i huvudet och tidssektionen (#1520)", () => {
    const WARNING = /Närmar sig taket|Taket passerat/;
    const header = () => screen.getByTestId("matter-header");
    const panel = (c: HTMLElement, id: string): HTMLElement => {
      const el = c.querySelector<HTMLElement>(`[data-panel="${id}"]`);
      if (!el) throw new Error(`panelen ${id} saknas`);
      return el;
    };
    const openPaymentDialog = (): HTMLElement => {
      fireEvent.click(within(header()).getByRole("button", { name: "Ändra ärende" }));
      return screen.getByRole("dialog", { name: "Ändra ärende" });
    };

    it("rättshjälp över tröskeln: varningen i huvudet, i tidssektionen och som förut i betalningsdialogen", async () => {
      matterQuery.data = { ...M, rattshjalpMaxTimmar: 100 };
      coverageQuery.data = { billableMinutes: 85 * 60, billableValueOre: 0 };
      const { container } = renderPage();
      await waitFor(() => expect(within(header()).getByText("⚠ Närmar sig taket (85 %)")).toBeInTheDocument());
      expect(within(panel(container, "time")).getByText(WARNING)).toBeInTheDocument();
      expect(within(openPaymentDialog()).getByText(WARNING)).toBeInTheDocument();
    });

    it("rättshjälp under tröskeln: ingen varning någonstans", async () => {
      coverageQuery.data = { billableMinutes: 79 * 60, billableValueOre: 0 };
      renderPage();
      await waitFor(() => expect(header()).toBeInTheDocument());
      expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    });

    it("rättsskydd: varningen i huvudet (#1732) och i betalningsdialogen, inte i tidssektionen", async () => {
      matterQuery.data = { ...M, paymentMethod: "RATTSSKYDD", rattsskyddMaxOre: 10_000_000 };
      coverageQuery.data = { billableMinutes: 100 * 60, billableValueOre: 9_500_000 };
      const { container } = renderPage();
      await waitFor(() => expect(within(header()).getByText("⚠ Närmar sig taket (95 %)")).toBeInTheDocument());
      await waitFor(() => expect(within(openPaymentDialog()).getByText(WARNING)).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
      expect(within(panel(container, "time")).queryByText(WARNING)).not.toBeInTheDocument();
    });

    it("privat ärende: ingen takvarning i huvudet (#1732)", async () => {
      matterQuery.data = { ...M, paymentMethod: "PRIVAT", rattsskyddMaxOre: 10_000_000 };
      coverageQuery.data = { billableMinutes: 100 * 60, billableValueOre: 9_500_000 };
      renderPage();
      await waitFor(() => expect(header()).toBeInTheDocument());
      expect(within(header()).queryByText(WARNING)).not.toBeInTheDocument();
    });
  });

  it("Domstolsbetalningar-panelen finns bara i domstolsärenden eller med registrerade fordringar (#1213)", async () => {
    const panel = (c: HTMLElement) => c.querySelector('[data-panel="receivables"]');
    const first = renderPage();
    await waitFor(() => expect(screen.getByText("2026-0001")).toBeInTheDocument());
    expect(panel(first.container)).toBeNull();
    first.unmount();

    matterQuery.data = { ...M, paymentMethod: "OFFENTLIGT_UPPDRAG" };
    const court = renderPage();
    await waitFor(() => expect(panel(court.container)).not.toBeNull());
    court.unmount();

    matterQuery.data = M;
    receivablesQuery.data = [{ id: "r1" }];
    const withRows = renderPage();
    await waitFor(() => expect(panel(withRows.container)).not.toBeNull());
    receivablesQuery.data = [];
  });

  it("Domstolsbetalningar följer betalningssättet, inte taxeflaggan ensam (#1972)", async () => {
    const panel = (c: HTMLElement) => c.querySelector('[data-panel="receivables"]');
    const shows = async (data: Record<string, unknown>, rows: unknown[] = []): Promise<boolean> => {
      matterQuery.data = { ...M, ...data };
      receivablesQuery.data = rows;
      const r = renderPage();
      await waitFor(() => expect(screen.getByText("2026-0001")).toBeInTheDocument());
      const shown = panel(r.container) !== null;
      r.unmount();
      return shown;
    };

    // Bytt från offentligt uppdrag men behållit flaggan: ingen panel utan fordringar.
    expect(await shows({ paymentMethod: "PRIVAT", isTaxeArende: true })).toBe(false);
    expect(await shows({ paymentMethod: "RATTSHJALP", isTaxeArende: true })).toBe(false);
    // …men en registrerad fordran döljs aldrig.
    expect(await shows({ paymentMethod: "PRIVAT", isTaxeArende: true }, [{ id: "r1" }])).toBe(true);
    expect(await shows({ paymentMethod: "RATTSHJALP", isTaxeArende: true }, [{ id: "r1" }])).toBe(true);
    // Offentligt uppdrag, med och utan flaggan: som i dag.
    expect(await shows({ paymentMethod: "OFFENTLIGT_UPPDRAG", isTaxeArende: true })).toBe(true);
    expect(await shows({ paymentMethod: "OFFENTLIGT_UPPDRAG", isTaxeArende: false })).toBe(true);
    matterQuery.data = M;
    receivablesQuery.data = [];
  });

  it("märket Taxa och taxetexterna följer isTaxeMatter, inte flaggan ensam (#1971)", async () => {
    const taxeTexts = async (): Promise<{ badge: boolean; time: boolean; expense: boolean }> => {
      const header = await waitFor(() => screen.getByTestId("matter-header"));
      const badge = within(header).queryByText("Taxa") !== null;
      fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
      const time = screen.queryByText("Taxeärende") !== null;
      fireEvent.click(screen.getByRole("button", { name: /\+ Nytt utlägg/i }));
      const expense = screen.queryAllByText("Taxeärende").length > (time ? 1 : 0);
      return { badge, time, expense };
    };

    matterQuery.data = { ...M, paymentMethod: "PRIVAT", isTaxeArende: true };
    const privat = renderPage();
    expect(await taxeTexts()).toEqual({ badge: false, time: false, expense: false });
    privat.unmount();

    matterQuery.data = { ...M, paymentMethod: "OFFENTLIGT_UPPDRAG", isTaxeArende: true };
    renderPage();
    expect(await taxeTexts()).toEqual({ badge: true, time: true, expense: true });
    matterQuery.data = M;
  });

  it("renderar matterNumber + title + klient-länk", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("2026-0001")).toBeInTheDocument());
    expect(screen.getByText("Bodelning Lindström")).toBeInTheDocument();
    // "Anna" finns flera ställen — minst en är klient-länken
    expect(screen.getAllByRole("link", { name: "Anna" }).length).toBeGreaterThan(0);
  });

  it("Betalningssätt är ingen flik; en enda Ändra i huvudet öppnar ärendedialogen (#1499, #1565)", async () => {
    const { container } = renderPage();
    const header = await waitFor(() => screen.getByTestId("matter-header"));
    expect(container.querySelector('[data-panel="payment"]')).toBeNull();
    expect(within(header).queryByRole("button", { name: "Ändra betalningssätt" })).not.toBeInTheDocument();
    fireEvent.click(within(header).getByRole("button", { name: "Ändra ärende" }));
    const dialog = screen.getByRole("dialog", { name: "Ändra ärende" });
    expect(within(dialog).getByLabelText("Titel")).toHaveValue("Bodelning Lindström");
    expect(within(dialog).getByLabelText("Betalningssätt")).toHaveValue("RATTSHJALP");
    expect(within(dialog).getAllByRole("button", { name: "Spara" })).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog", { name: "Ändra ärende" })).not.toBeInTheDocument();
  });

  it("renderar mockade barnkomponenter", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("doc-browser")).toBeInTheDocument());
    expect(screen.getByTestId("suggestions")).toBeInTheDocument();
    expect(screen.getByTestId("events")).toBeInTheDocument();
    // 'invoices'-panelen är borttagen — BillingPanel ersätter den
  });

  it("visar Aktivt-badge när status=ACTIVE", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Aktivt")).toBeInTheDocument());
  });

  it("visar Stängt-badge när status=CLOSED", async () => {
    matterQuery.data = { ...M, status: "CLOSED" };
    renderPage();
    await waitFor(() => expect(screen.getByText("Stängt")).toBeInTheDocument());
  });

  it("Avsluta ärende går genom hooken med ärendets id och titel (#2100)", async () => {
    statusActions.close.mockClear();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Avsluta ärende" }));
    expect(statusActions.close).toHaveBeenCalledWith({ id: "m1", title: M.title });
  });

  it("Återöppna går genom hooken för ett stängt ärende, och knapparna är inaktiva medan ett anrop pågår (#2100)", async () => {
    statusActions.reopen.mockClear();
    matterQuery.data = { ...M, status: "CLOSED" };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Återöppna" }));
    expect(statusActions.reopen).toHaveBeenCalledWith("m1");
    statusActions.isPending = true;
    try {
      renderPage();
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Återöppna" })).toHaveLength(2));
      expect(screen.getAllByRole("button", { name: "Återöppna" }).at(-1)).toBeDisabled();
    } finally {
      statusActions.isPending = false;
    }
  });

  it("öppnar Generera dokument-modal", async () => {
    renderPage();
    const button = await waitFor(() =>
      screen.getByRole("button", { name: /Generera dokument/i }),
    );
    fireEvent.click(button);
    await settle();
    expect(screen.getByText(/Välj mall/i)).toBeInTheDocument();
  });

  it("visar tidregistrering-totalt i decimaltimmar (#1542)", async () => {
    timeQuery.data = { entries: [], totalMinutes: 90 };
    renderPage();
    await waitFor(() => expect(screen.getByText("(totalt 1,5 h)")).toBeInTheDocument());
  });

  // Regression: när time-entry-listans `user`-join returnerar null (t.ex. mot
  // git-db där en användare raderats) får tabellen INTE krascha med
  // "Cannot read properties of null (reading 'name')".
  it("renderar tidsrad även om entry.user är null", async () => {
    timeQuery.data = {
      entries: [
        { id: "t1", date: "2026-01-15", minutes: 60, description: "Möte", billable: true, user: null },
      ],
      totalMinutes: 60,
    };
    renderPage();
    await waitFor(() => expect(screen.getByText("Möte")).toBeInTheDocument());
    // Fallback-texten visas i Advokat-kolumnen (kan finnas fler "—" i andra kolumner)
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("visar Arkiverat-badge för andra statusar", async () => {
    matterQuery.data = { ...M, status: "ARCHIVED" };
    renderPage();
    await waitFor(() => expect(screen.getByText("Arkiverat")).toBeInTheDocument());
  });

  it("renderar matterType (text i fetstil #1521/#1566) + description", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("matter-type")).toHaveTextContent(/^Familjerätt$/));
    expect(screen.getByTestId("matter-type")).toHaveClass("font-bold");
    expect(screen.getByTestId("matter-description")).toHaveTextContent("Beskrivning: En bodelning");
  });

  it("'+ Lägg till' kontakt öppnar sökdialogen; Avbryt stänger (#1136)", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Lägg till/i }));
    expect(screen.getByRole("dialog", { name: "Välj part" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("klickar Ta bort på en kontakt", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    const removeButtons = screen.getAllByRole("button", { name: /^Ta bort$/i });
    fireEvent.click(removeButtons[0]!);
    await waitFor(() => expect(inputsTo("matter.removeContact")).toEqual([{ matterContactId: "mc1" }]));
  });

  it("öppnar tidsformulär och submittar", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    const desc = screen.getByPlaceholderText(/Beskrivning/i);
    fireEvent.change(desc, { target: { value: "Mejl och telefon" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    await waitFor(() => expect(inputsTo("timeEntry.create")).toHaveLength(1));
    const arg = inputsTo("timeEntry.create")[0] ?? {};
    expect(arg.matterId).toBe("m1");
    expect(arg.description).toBe("Mejl och telefon");
    expect(arg.billable).toBe(true);
  });

  it("togglar debiterbar-checkbox i tidsformulär", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Registrera tid/i }));
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: "Debiterbar" });
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("öppnar utläggsformulär och submittar", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /\+ Nytt utlägg/i }));
    const desc = screen.getByPlaceholderText(/Beskrivning/i);
    fireEvent.change(desc, { target: { value: "Domstolsavgift" } });
    const numberInput = screen.getByPlaceholderText(/0,00/);
    fireEvent.change(numberInput, { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /^Spara$/i }));
    await waitFor(() => expect(inputsTo("expense.create")).toHaveLength(1));
    const arg = inputsTo("expense.create")[0] ?? {};
    expect(arg.amount).toBe(15000); // 150 kr exkl. → lagras netto 150 kr (#782)
    expect(arg.description).toBe("Domstolsavgift");
  });

  it("renderar tidsposter i tabellen", async () => {
    timeQuery.data = {
      entries: [
        {
          id: "te1",
          date: new Date("2026-04-01"),
          minutes: 60,
          description: "Telefonsamtal",
          billable: true,
          user: { name: "Lisa Lawyer" },
        },
      ],
      totalMinutes: 60,
    };
    renderPage();
    await waitFor(() => expect(screen.getByText("Telefonsamtal")).toBeInTheDocument());
    expect(screen.getByText("Lisa Lawyer")).toBeInTheDocument();
  });

  it("renderar utlägg och tar bort vid klick", async () => {
    expenseQuery.data = {
      expenses: [
        {
          id: "e1",
          date: new Date("2026-04-01"),
          amount: 15000,
          description: "Domstolsavgift",
          billable: true,
          user: { name: "Lisa" },
        },
      ],
      totalAmount: 15000,
    };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true); // delete bakom confirm nu
    renderPage();
    await waitFor(() => expect(screen.getByText("Domstolsavgift")).toBeInTheDocument());
    // Knappen på just utläggsraden — panelernas ordning styrs av layouten (#1185).
    const row = screen.getByRole("row", { name: /Domstolsavgift/ });
    fireEvent.click(within(row).getByRole("button", { name: /^Ta bort$/i }));
    await waitFor(() => expect(inputsTo("expense.delete")).toEqual([{ id: "e1" }]));
    confirmSpy.mockRestore();
  });

  it("byter format till HTML-fil i generera-modal", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    await settle();
    // Format-alternativen är nu "PDF (via utskrift)" / "HTML-fil" (värde docx).
    const htmlRadio = screen.getByRole<HTMLInputElement>("radio", { name: /HTML/i });
    fireEvent.click(htmlRadio);
    expect(htmlRadio.checked).toBe(true);
  });

  it("kryssar i mottagare i generera-modal", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    await settle();
    // Mottagar-checkboxen för Anna
    const allChecks = screen.getAllByRole("checkbox");
    const annaCheck = allChecks.find((c) =>
      (c as HTMLInputElement).closest("label")?.textContent?.includes("Anna"),
    ) as HTMLInputElement | undefined;
    expect(annaCheck).toBeTruthy();
    fireEvent.click(annaCheck!);
    expect(annaCheck!.checked).toBe(true);
    // Räknaren ska visa 1
    expect(screen.getByText(/Mottagare \(1\)/i)).toBeInTheDocument();
  });

  it("listar mallar i selectern och tillåter val", async () => {
    templatesQuery.data = [
      { id: "tpl1", name: "Stämning", category: "Avtal" },
      { id: "tpl2", name: "Fullmakt", category: null },
    ];
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    await settle();
    expect(screen.getByText(/Avtal – Stämning/)).toBeInTheDocument();
    expect(screen.getByText(/Fullmakt/)).toBeInTheDocument();
  });

  it("visar Skapa en mall-länk när inga mallar finns", async () => {
    templatesQuery.data = [];
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    await settle();
    expect(screen.getByRole("link", { name: /Skapa en mall/i })).toBeInTheDocument();
  });

  it("stänger generera-modal med Avbryt", async () => {
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    await settle();
    expect(screen.getByText(/Välj mall/i)).toBeInTheDocument();
    const avbrytButtons = screen.getAllByRole("button", { name: /Avbryt/i });
    fireEvent.click(avbrytButtons[avbrytButtons.length - 1]!);
    expect(screen.queryByText(/Välj mall/i)).not.toBeInTheDocument();
  });

  it("genererar dokument client-side (öppnar blob i ny flik)", async () => {
    // Ny flöde: renderHandlebars i browsern → window.open(blob), ingen /api-fetch.
    templatesQuery.data = [{ id: "tpl1", name: "Stämning", category: null, content: "<p>{{matter.matterNumber}}</p>" }];
    const openMock = vi.fn();
    Object.defineProperty(window, "open", { value: openMock, writable: true, configurable: true });
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:fake"), writable: true, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true, configurable: true });
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    await settle();
    const select = screen.getByRole<HTMLSelectElement>("combobox");
    fireEvent.change(select, { target: { value: "tpl1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generera$/i }));
    await waitFor(() => expect(openMock).toHaveBeenCalledWith("blob:fake", "_blank", "noopener,noreferrer"));
  });

  it("visar fel när mallen saknar innehåll", async () => {
    templatesQuery.data = [{ id: "tpl1", name: "Stämning", category: null }]; // ingen content
    renderPage();
    await waitFor(() => screen.getByText("2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: /Generera dokument/i }));
    await settle();
    const select = screen.getByRole<HTMLSelectElement>("combobox");
    fireEvent.change(select, { target: { value: "tpl1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generera$/i }));
    await waitFor(() => expect(screen.getByText(/Mallen saknar innehåll/)).toBeInTheDocument());
  });
});
