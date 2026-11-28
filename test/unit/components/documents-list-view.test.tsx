/**
 * DocumentsListView — flat-vy för dokument med folder-path-kolumn.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest-compat";
import { DocumentsListView } from "@/components/documents/_documents-list-view";
import { asId } from "@/lib/shared/schemas/ids";

/** Sparade kolumninställningar (DataTable läser dem via `prefs.get`). */
const persisted = { data: undefined as undefined | { user: unknown; org: unknown } };

// Office 365-konfigurationen (#1951): av som standard, så att Maila… inte syns.
vi.mock("@/components/documents/use-office365-configured", () => ({ useOffice365Configured: () => false }));
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } }, document: { partsByMatter: { invalidate: vi.fn() }, tree: { invalidate: vi.fn() } } }),
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
    document: {
      takeoverLease: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
      setPartKind: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    prefs: {
      get: { useQuery: () => ({ data: persisted.data, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseDoc = (overrides: any = {}) => ({
  id: "d1",
  fileName: "stamning.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  storagePath: "/x",
  version: 1,
  matterId: "m1",
  folderId: null,
  uploadedById: "u1",
  createdAt: new Date("2026-05-01"),
  uploadedBy: { name: "Anna" },
  title: null,
  documentType: "Stämning",
  summary: null,
  analyzedAt: null,
  analysisError: null,
  ...overrides,
});

/** Inget laddas upp, ingen analys pågår. */
const idle = { uploadingIds: new Set<string>(), analyzingIds: new Set<string>(), reanalyzePending: false };

const baseFolder = (id: string, name: string, parentId: string | null = null) =>
  ({
    id: asId<"DocumentFolderId">(id),
    name,
    parentId: parentId === null ? null : asId<"DocumentFolderId">(parentId),
    matterId: asId<"MatterId">("m1"),
    createdAt: new Date(),
  });

describe("DocumentsListView", () => {
  it("tipset säger Mapp-vy när ärendet har mappar (#1804)", () => {
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} folders={[baseFolder("f1", "Inlagor")]}
        documents={[]} onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    expect(screen.getByText("Mapp-vy")).toBeInTheDocument();
    expect(screen.getByText(/för att hantera mappar och drag-and-drop/)).toBeInTheDocument();
  });

  it("#1220: Typ-kolumnen visar etiketter (inte koder) och delarna i sammansatta dokument", () => {
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} folders={[]}
        documents={[
          baseDoc({ id: "d1", fileName: "a.pdf", documentType: "STAMNING" }),
          baseDoc({ id: "d2", fileName: "b.pdf", documentType: "KALLELSE", parts: [
            { id: "p1", kind: "KALLELSE", fromPage: 1, toPage: 1, source: "AUTO" },
            { id: "p2", kind: "FUP", fromPage: 2, toPage: 40, source: "AUTO" },
          ] }),
        ]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    // Typen syns både i namncellens märke och i kolumnen Typ.
    expect(screen.getAllByText("Stämning")).toHaveLength(2);
    expect(screen.getAllByText("Kallelse + FUP")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /2 delar/ }));
    expect(screen.getByText("s. 2–40")).toBeInTheDocument();
  });

  it("renderar tomt-state när inga docs", () => {
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[]} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    expect(screen.getByText(/Inga dokument/)).toBeInTheDocument();
  });

  it("renderar dokumentens filnamn, typ, mapp-path", () => {
    const folder = baseFolder("f1", "Underlag");
    const doc = baseDoc({ folderId: "f1" });
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[doc]} folders={[folder]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    expect(screen.getByText("stamning.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("Stämning")).toHaveLength(2);
    expect(screen.getByText("/Underlag")).toBeInTheDocument();
  });

  it("nästlad folder-path renderas som /Parent/Child", () => {
    const f1 = baseFolder("f1", "Parent");
    const f2 = baseFolder("f2", "Child", "f1");
    const doc = baseDoc({ folderId: "f2" });
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[doc]} folders={[f1, f2]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    expect(screen.getByText("/Parent/Child")).toBeInTheDocument();
  });

  it("uploadedBy=undefined kraschar inte — visar '—'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = baseDoc({ uploadedBy: undefined } as any);
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[doc]} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    // Filen renderas (alltså föll inte koden in i error-boundary)
    expect(screen.getByText("stamning.pdf")).toBeInTheDocument();
  });

  it("filnamnet renderas som klickbar knapp (default: openDocumentSmart)", () => {
    const doc = baseDoc();
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[doc]} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    expect(screen.getByRole("button", { name: /stamning\.pdf/ })).toBeEnabled();
  });

  // Keep-both end-state i UIt (#742, ADR 0033 §4): efter en konflikt finns
  // BÅDE originalet och syskon-kopian i ärendet → juristen ser 2 filer, en
  // tydligt namngiven som sin egen sparade version. Det är vad en användare
  // ser i webb-appen efter att en av två redigerare fått "Konflikt".
  it("visar både originalet och konflikt-syskonet (2 filer)", () => {
    const original = baseDoc({ id: "d1", fileName: "minnesanteckning.txt", documentType: "Anteckning" });
    const sibling = baseDoc({
      id: "d2", fileName: "minnesanteckning (din ändring 2027-03-14 09:15).txt", documentType: "Anteckning",
    });
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[original, sibling]} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    expect(screen.getByRole("button", { name: /^📄 minnesanteckning\.txt/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^📄 minnesanteckning \(din ändring 2027-03-14 09:15\)\.txt/ }),
    ).toBeInTheDocument();
  });
});

/**
 * #983: listvyn byggde en EGEN, kortare kebab-meny. Samma dokument på samma
 * sida gav alltså olika möjligheter beroende på vilken vy man råkade stå i —
 * Öppna, Visa och Ladda ner fanns bara i trädet. Båda vyerna renderar nu
 * `DocumentActions`, och testerna nedan vaktar att de inte glider isär igen.
 */
describe("DocumentsListView — kebab-menyn (#983)", () => {
  function renderRow() {
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[baseDoc()]} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    return screen.getByRole("menu", { name: "Dokumentåtgärder" });
  }

  it("erbjuder hela dokumentuppsättningen, inte bara redigera/analysera/ta bort", () => {
    const menu = renderRow();
    for (const label of ["Öppna i webbläsaren", "Editera externt", "Visa", "Ladda ner", "Ta bort"]) {
      expect(menu.textContent, `${label} saknas i listvyns meny`).toContain(label);
    }
  });

  it("Ta bort kräver bekräftelse och anropar onDelete med dokumentets id", () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    try {
      render(
        <DocumentsListView
          matterId={asId<"MatterId">("m1")} documents={[baseDoc()]} folders={[]}
          onDelete={onDelete} onReanalyze={() => {}} {...idle}
        />,
      );
      fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
      fireEvent.click(screen.getByText("Ta bort"));
      expect(confirmSpy).toHaveBeenCalled();
      expect(onDelete).toHaveBeenCalledWith("d1");
    } finally {
      confirmSpy.mockRestore();
    }
  });
});

/**
 * Mobil-bredd (#983). Listvyn visade sex kolumner även på 390 px och överflödade
 * med 456 px, medan träd-vyn dolde sina sekundära kolumner. jsdom räknar inte
 * layout, så testet granskar KLASSERNA — själva överflödet mäts i e2e:t.
 */
describe("DocumentsListView — kolumner på små skärmar (#983)", () => {
  it("sekundära kolumner bär responsiv döljning; filnamnet gör det inte", () => {
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[baseDoc()]} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
    const headerFor = (label: string): HTMLElement =>
      screen.getByText(new RegExp(`^${label}`)).closest("th")!;

    // Filnamnet är det enda som alltid måste synas — det får inte döljas.
    expect(headerFor("Filnamn").className).not.toContain("hidden");
    for (const label of ["Typ", "Datum", "Mapp", "Uppladdad av"]) {
      expect(headerFor(label).className, `${label} ska döljas på små skärmar`).toContain("hidden");
    }
  });
});

/**
 * #1803: kolumnen Storlek finns inte i listvyn, inte heller i menyn Kolumner,
 * och en sparad inställning som nämner `sizeBytes` fäller inte listan.
 */
describe("DocumentsListView — ingen kolumn Storlek (#1803)", () => {
  afterEach(() => { persisted.data = undefined; });

  function renderList(): void {
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[baseDoc({ sizeBytes: 5_000_000 })]} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle}
      />,
    );
  }

  it("ingen kolumnrubrik Storlek och inget val Storlek i menyn Kolumner", () => {
    renderList();
    expect(screen.queryByRole("columnheader", { name: /Storlek/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/4\.8 MB/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Kolumner/ }));
    const menu = screen.getByRole("group", { name: "Kolumner" });
    expect(menu).toHaveTextContent("Datum");
    expect(menu).not.toHaveTextContent("Storlek");
  });

  it("en sparad sortering på sizeBytes fäller inte listan", () => {
    persisted.data = {
      user: { sortBy: "sizeBytes", sortDir: "desc", columns: [{ key: "sizeBytes", hidden: false }] },
      org: null,
    };
    renderList();
    expect(screen.getByText("stamning.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Storlek/ })).not.toBeInTheDocument();
  });
});

/**
 * #1796: listvyn (standardvyn) använder samma namncell som träd-vyn och får
 * samma data: pågående uppladdningar, titel, analysstatus och analysspärren.
 */
describe("DocumentsListView — namncellen och statusen (#1796)", () => {
  function renderList(docs: ReturnType<typeof baseDoc>[], props: Partial<typeof idle> = {}) {
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={docs} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}} {...idle} {...props}
      />,
    );
  }
  function openMenu() {
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    return screen.getByRole("menu", { name: "Dokumentåtgärder" });
  }

  it("en pågående uppladdning: gråtonad, ej klickbar namncell och spärrad meny", () => {
    renderList([baseDoc({ id: "pending-1", fileName: "skiss.pdf" })], { uploadingIds: new Set(["pending-1"]) });
    const button = screen.getByRole("button", { name: /skiss\.pdf/ });
    expect(button).toBeDisabled();
    expect(button.closest(".opacity-60")).not.toBeNull();
    expect(button.parentElement?.textContent).toContain("Laddar upp");
    const menuButton = screen.getByLabelText("Dokumentåtgärder");
    expect(menuButton).toBeDisabled();
    expect(menuButton.getAttribute("title")).toBe("Vänta tills uppladdningen är klar");
  });

  it("ett färdigt dokument är inte gråtonat", () => {
    renderList([baseDoc()]);
    expect(screen.getByRole("button", { name: /stamning\.pdf/ }).closest(".opacity-60")).toBeNull();
    expect(screen.getByLabelText("Dokumentåtgärder").getAttribute("title")).toBe("Dokumentåtgärder");
  });

  it("visar titeln, och filnamnet under den", () => {
    renderList([baseDoc({ title: "Stämningsansökan", analyzedAt: new Date("2026-05-02") })]);
    expect(screen.getByText("Stämningsansökan")).toBeInTheDocument();
    expect(screen.getByText("stamning.pdf")).toBeInTheDocument();
  });

  it("visar \"⏳ analyseras…\" medan analysen pågår", () => {
    renderList([baseDoc()], { analyzingIds: new Set(["d1"]) });
    expect(screen.getByText("⏳ analyseras…")).toBeInTheDocument();
  });

  it("visar \"⚠ analys-fel\" när analysen fallerat", () => {
    renderList([baseDoc({ analysisError: "timeout" })]);
    expect(screen.getByText("⚠ analys-fel")).toBeInTheDocument();
  });

  it("\"Analysera (AI)\" är spärrad när reanalyzePending", () => {
    renderList([baseDoc()], { reanalyzePending: true });
    openMenu();
    expect(screen.getByRole("menuitem", { name: /Analysera \(AI\)/ })).toBeDisabled();
  });

  it("\"Analysera (AI)\" går att välja när ingen analys pågår", () => {
    const onReanalyze = vi.fn();
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[baseDoc()]} folders={[]}
        onDelete={() => {}} onReanalyze={onReanalyze} {...idle}
      />,
    );
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    fireEvent.click(screen.getByText("Analysera (AI)"));
    expect(onReanalyze).toHaveBeenCalledWith("d1");
  });
});
