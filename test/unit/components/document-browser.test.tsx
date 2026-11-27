/**
 * Test för DocumentBrowser — träd-rendering, ikoner, badges, tomtillstånd.
 *
 * Flytt med drag-and-drop och släpp av filer utifrån (#1615) testas med
 * syntetiska `dataTransfer`; bas-renderingen
 * och de flesta interaktiva UI-flöden täcks: + Ny mapp, + Ladda upp, "..."
 * etc.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { DocumentBrowser } from "@/components/documents/document-browser";
import { asId } from "@/lib/shared/schemas/ids";

// Self-hosted-läget letar efter ett FSA-handle via IndexedDB; jsdom har inte
// någon working copy uppsatt. Mock:a explicit så testen är deterministisk
// oavsett om andra tester polyfillar IndexedDB.
vi.mock("@/lib/client/fsa/handle-store", () => ({
  loadHandle: vi.fn(async () => null),
  saveHandle: vi.fn(async () => {}),
  deleteHandle: vi.fn(async () => {}),
  ensureReadWrite: vi.fn(async () => false),
  isFsaSupported: vi.fn(() => false),
  isOpfsSupported: vi.fn(() => false),
  getOpfsRoot: vi.fn(async () => null),
}));

type Doc = Record<string, unknown>;
type Folder = Record<string, unknown>;

const treeQuery = {
  data: { folders: [] as Folder[], documents: [] as Doc[] },
  isLoading: false,
};

/** Ärendets dokumentdelar (#1220). */
const partsQuery = { data: [] as Array<Record<string, unknown>> };
const setPartKind = { mutate: vi.fn(), isPending: false };
let setPartKindOptions: { onSuccess?: () => void } = {};

/** Klientens jobbkö — klassificeringen ska INTE köas när servern äger den (#1220). */
const jobQueueEnqueue = vi.fn();
vi.mock("@/lib/client/jobs/job-queue", () => ({ jobQueue: { enqueue: jobQueueEnqueue } }));

/** Vanilla-klienten uppladdningen använder (uploadContent + suggestFromText). */
const clientMock = {
  document: {
    uploadContent: { mutate: vi.fn(async () => ({})) },
    suggestFromText: { mutate: vi.fn(async () => ({ parties: 1, events: 0 })) },
  },
};

const utilsMock = {
  client: clientMock,
  document: {
    tree: { invalidate: vi.fn(), fetch: vi.fn().mockResolvedValue({ folders: [], documents: [] }) },
    partsByMatter: { invalidate: vi.fn() },
    pendingSuggestionsGrouped: { invalidate: vi.fn() },
    pendingSuggestions: { invalidate: vi.fn() },
  },
  matter: { getById: { invalidate: vi.fn() } },
  prefs: { get: { invalidate: vi.fn() } },
};

/**
 * "Analysera (AI)" ska köa text-extraktion (#988) — utan texten kan inga
 * kontakt-/händelseförslag uppstå. Själva köandet testas i
 * `enqueue-text-extraction.test.ts`; här testas att browsern hittar rätt
 * dokument och skickar det vidare.
 */
const enqueueTextExtraction = vi.fn(async () => {});
vi.mock("@/lib/client/jobs/enqueue-text-extraction", () => ({ enqueueTextExtraction }));

// Byte-uppladdningen cachar innehållet i IndexedDB, som saknas i jsdom.
// Uppladdningens senare steg (jobb + förslag) är det som testas här.
vi.mock("@/lib/client/backend/save-document-content", () => ({
  saveDocumentContent: vi.fn(async () => "sha"),
}));

/** Mutationens options fångas så `mutate` kan köra `onMutate` som React Query gör. */
interface AnalyzeOptions { onMutate?: (vars: { documentId: string }) => void }
let analyzeOptions: AnalyzeOptions = {};

const mutationStubs = {
  createFolder: { mutate: vi.fn(), isPending: false },
  renameFolder: { mutate: vi.fn(), isPending: false },
  deleteFolder: { mutate: vi.fn(), isPending: false },
  moveDocument: { mutate: vi.fn(), isPending: false },
  moveFolder: { mutate: vi.fn(), isPending: false },
  delete: { mutate: vi.fn(), isPending: false },
  analyze: { mutate: vi.fn(), isPending: false },
  register: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
};

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    document: {
      tree: { useQuery: () => treeQuery },
      partsByMatter: { useQuery: () => partsQuery },
      setPartKind: { useMutation: (opts?: { onSuccess?: () => void }) => { setPartKindOptions = opts ?? {}; return setPartKind; } },
      createFolder: { useMutation: () => mutationStubs.createFolder },
      renameFolder: { useMutation: () => mutationStubs.renameFolder },
      deleteFolder: { useMutation: () => mutationStubs.deleteFolder },
      moveDocument: { useMutation: () => mutationStubs.moveDocument },
      moveFolder: { useMutation: () => mutationStubs.moveFolder },
      delete: { useMutation: () => mutationStubs.delete },
      analyze: { useMutation: (opts?: AnalyzeOptions) => { analyzeOptions = opts ?? {}; return mutationStubs.analyze; } },
      register: { useMutation: () => mutationStubs.register },
      takeoverLease: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
    },
    organization: { getSettings: { useQuery: () => ({ data: { documentKinds: [] } }) } },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Sync-badgarna probar AVA Helper på loopback (useDocSyncStatus). Ingen helper
  // finns i testet — stubba bort den så proben aldrig når en riktig (#1368).
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("ingen AVA Helper i testet"); }));
  // Tester nedan validerar träd-vyn explicit (+Ny mapp, drag-and-drop osv.);
  // tvinga träd-läget innan varje render (default är annars "list").
  window.localStorage.setItem("ava.documents.viewMode", "tree");
  treeQuery.data = { folders: [], documents: [] };
  partsQuery.data = [];
  mutationStubs.createFolder.mutate = vi.fn();
  mutationStubs.renameFolder.mutate = vi.fn();
  mutationStubs.deleteFolder.mutate = vi.fn();
  mutationStubs.moveDocument.mutate = vi.fn();
  mutationStubs.moveFolder.mutate = vi.fn();
  mutationStubs.delete.mutate = vi.fn();
  // Som React Query: `mutate` kör mutationens `onMutate` innan anropet.
  mutationStubs.analyze.mutate = vi.fn((vars: { documentId: string }) => analyzeOptions.onMutate?.(vars));
});

const baseDoc = (overrides: Partial<Doc> = {}): Doc => ({
  id: "d1",
  fileName: "test.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  storagePath: "/x",
  version: 1,
  matterId: "m1",
  folderId: null,
  uploadedById: "u1",
  createdAt: new Date("2026-04-15"),
  uploadedBy: { name: "Anna" },
  title: null,
  documentType: null,
  summary: null,
  analyzedAt: null,
  analysisError: null,
  ...overrides,
});

const baseFolder = (overrides: Partial<Folder> = {}): Folder => ({
  id: "f1",
  name: "Inlagor",
  parentId: null,
  matterId: "m1",
  createdAt: new Date("2026-04-01"),
  ...overrides,
});

/** Filväljarens input bakom **+ Ladda upp**. */
const fileInput = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>("input[type=file]");
  if (!input) throw new Error("filväljaren saknas");
  return input;
};
/** Välj filer med **+ Ladda upp** (#1976: de hamnar i namnrutans kö). */
function choose(files: File[]): void {
  Object.defineProperty(fileInput(), "files", { value: files, configurable: true });
  fireEvent.change(fileInput());
}
/** Välj filer med **+ Ladda upp** och tryck **Spara** i namnrutan för var och en. */
function uploadViaButton(files: File[]): void {
  choose(files);
  for (const _ of files) fireEvent.click(screen.getByRole("button", { name: "Spara" }));
}

describe("DocumentBrowser", () => {
  it("vyvalet visar Lista och Mapp-vy (ingen knapp Träd) med aria-pressed på den valda (#1804)", () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByRole("group", { name: "Dokumentvy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mapp-vy" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Träd" })).not.toBeInTheDocument();
  });

  it("klick på Mapp-vy från listvyn byter till mappvyn och sparar \"tree\" (#1804)", () => {
    window.localStorage.setItem("ava.documents.viewMode", "list");
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Mapp-vy" }));
    expect(screen.getByRole("button", { name: "Mapp-vy" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Ny mapp/ })).toBeInTheDocument();
    expect(window.localStorage.getItem("ava.documents.viewMode")).toBe("tree");
  });

  it("visar tomtillstånd när inga mappar/dokument finns", () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText(/Inga dokument eller mappar/i)).toBeInTheDocument();
  });

  it("renderar dokumentnamn för loose root-fil", () => {
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText("test.pdf")).toBeInTheDocument();
  });

  it("filtrerar på riktning + mottagare — 'utgående till domstol' (#901)", () => {
    treeQuery.data = { folders: [], documents: [
      baseDoc({ id: "d1", fileName: "kostnadsrakning.pdf", direction: "UTGAENDE", recipient: "DOMSTOL" }),
      baseDoc({ id: "d2", fileName: "svaromal.pdf", direction: "INKOMMANDE", recipient: "MOTPART" }),
    ] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText("kostnadsrakning.pdf")).toBeInTheDocument();
    expect(screen.getByText("svaromal.pdf")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Riktning"), { target: { value: "UTGAENDE" } });
    fireEvent.change(screen.getByLabelText("Mottagare"), { target: { value: "DOMSTOL" } });
    expect(screen.getByText("kostnadsrakning.pdf")).toBeInTheDocument();
    expect(screen.queryByText("svaromal.pdf")).not.toBeInTheDocument();
  });

  describe("sammansatta dokument (#1220)", () => {
    const parts = [
      { id: "p1", documentId: "d1", kind: "KALLELSE", fromPage: 1, toPage: 2, source: "AUTO" },
      { id: "p2", documentId: "d1", kind: "STAMNING", fromPage: 3, toPage: 5, source: "MANUAL" },
      { id: "p3", documentId: "d1", kind: "FUP", fromPage: 6, toPage: 6, source: "AUTO" },
    ];

    it("visar delarnas etiketter och en expanderbar dellista med sidintervall", () => {
      treeQuery.data = { folders: [], documents: [baseDoc({ documentType: "KALLELSE" })] };
      partsQuery.data = parts;
      render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
      expect(screen.getByText("Kallelse + Stämning + FUP")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /3 delar/ }));
      expect(screen.getByText("s. 1–2")).toBeInTheDocument();
      expect(screen.getByText("s. 6")).toBeInTheDocument();
      expect(screen.getByText("rättad")).toBeInTheDocument();
    });

    it("rättar en dels typ via setPartKind och invaliderar", () => {
      treeQuery.data = { folders: [], documents: [baseDoc()] };
      partsQuery.data = parts;
      render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
      fireEvent.click(screen.getByRole("button", { name: /3 delar/ }));
      fireEvent.change(screen.getByLabelText("Rätta typ för del 3"), { target: { value: "BEVIS" } });
      expect(setPartKind.mutate).toHaveBeenCalledWith({ partId: "p3", kind: "BEVIS" });
      setPartKindOptions.onSuccess?.();
      expect(utilsMock.document.partsByMatter.invalidate).toHaveBeenCalled();
      expect(utilsMock.document.tree.invalidate).toHaveBeenCalled();
    });

    it("klick på en del öppnar dokumentet på delens första sida", async () => {
      window.localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo", repo: "ulrik-s/ava-demo" }));
      treeQuery.data = { folders: [], documents: [baseDoc()] };
      partsQuery.data = parts;
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      try {
        render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
        fireEvent.click(screen.getByRole("button", { name: /3 delar/ }));
        fireEvent.click(screen.getByTitle("Öppna på sidan 3"));
        await waitFor(() => expect(openSpy).toHaveBeenCalled(), { timeout: 2000 });
        expect(String(openSpy.mock.calls[0]![0])).toMatch(/#page=3$/);
      } finally {
        openSpy.mockRestore();
        window.localStorage.removeItem("ava.firma");
      }
    });

    it("typfiltret träffar valfri del", () => {
      treeQuery.data = { folders: [], documents: [
        baseDoc({ id: "d1", fileName: "sammansatt.pdf", documentType: "KALLELSE" }),
        baseDoc({ id: "d2", fileName: "dom.pdf", documentType: "DOM" }),
      ] };
      partsQuery.data = parts;
      render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
      fireEvent.change(screen.getByLabelText("Typ"), { target: { value: "FUP" } });
      expect(screen.getByText("sammansatt.pdf")).toBeInTheDocument();
      expect(screen.queryByText("dom.pdf")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Rensa" }));
      expect(screen.getByText("dom.pdf")).toBeInTheDocument();
    });

    it("server-first: klientens filnamnsgissning köas inte (servern klassificerar)", async () => {
      render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
      const file = new File(["text"], "stamning.txt", { type: "text/plain" });
      uploadViaButton([file]);
      await waitFor(() => expect(enqueueTextExtraction).toHaveBeenCalled());
      expect(jobQueueEnqueue).not.toHaveBeenCalledWith("classify-document", expect.anything(), expect.anything());
    });

    it("demo (ingen server-jobbkö): klienten klassificerar som förut", async () => {
      window.localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo", repo: "u/r" }));
      try {
        render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
        const file = new File(["text"], "stamning.txt", { type: "text/plain" });
        uploadViaButton([file]);
        await waitFor(() => expect(jobQueueEnqueue).toHaveBeenCalledWith("classify-document", expect.any(String), expect.anything()));
      } finally {
        window.localStorage.removeItem("ava.firma");
      }
    });
  });

  it("visar AI-extraherad titel istället för filnamn när satt", () => {
    treeQuery.data = {
      folders: [],
      documents: [baseDoc({ title: "Stämningsansökan 2026-0001", documentType: "Stämning" })],
    };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText("Stämningsansökan 2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Stämning", { selector: "span" })).toBeInTheDocument();
  });

  it("renderar mappar i trädet", () => {
    treeQuery.data = { folders: [baseFolder()], documents: [] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText("Inlagor")).toBeInTheDocument();
  });

  it("öppnar Ny mapp-form vid klick", () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny mapp/i }));
    expect(screen.getByPlaceholderText(/Mappnamn/i)).toBeInTheDocument();
  });

  it("visar analys-fel-badge när analysisError satt", () => {
    treeQuery.data = {
      folders: [],
      documents: [baseDoc({ analysisError: "Tika fail" })],
    };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText(/analys-fel/i)).toBeInTheDocument();
  });

  it("visar 'analyseras…'-badge för dokument som är < 5 min gamla", () => {
    const recent = new Date(Date.now() - 60_000); // 1 min sedan
    treeQuery.data = {
      folders: [],
      documents: [baseDoc({ createdAt: recent })],
    };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText(/analyseras/i)).toBeInTheDocument();
  });

  it("visar inte analyseras-badge för gamla, oanalyserade dokument", () => {
    const old = new Date("2025-01-01");
    treeQuery.data = { folders: [], documents: [baseDoc({ createdAt: old })] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.queryByText(/analyseras/i)).not.toBeInTheDocument();
  });

  it("har Visa, Ladda ner, Analysera, Ta bort i kebab-menyn på varje fil", () => {
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    expect(screen.getByText("Visa")).toBeInTheDocument();
    expect(screen.getByText("Ladda ner")).toBeInTheDocument();
    expect(screen.getByText(/Analysera/)).toBeInTheDocument();
    expect(screen.getByText("Ta bort")).toBeInTheDocument();
  });

  it("döljer 'Analysera (AI)' i demo-tier (LLM-kapabilitet saknas, ADR 0027)", () => {
    // demo-tier → capabilities.llm = false → analys-affordansen renderas inte.
    window.localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo", repo: "u/r" }));
    try {
      treeQuery.data = { folders: [], documents: [baseDoc()] };
      render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
      fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
      expect(screen.getByText("Visa")).toBeInTheDocument(); // övriga finns kvar
      expect(screen.getByText("Ta bort")).toBeInTheDocument();
      expect(screen.queryByText(/Analysera/)).not.toBeInTheDocument();
    } finally {
      window.localStorage.removeItem("ava.firma"); // återställ jsdom-default (self-hosted)
    }
  });

  it("submittar Ny mapp-formuläret med mappnamn", () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny mapp/i }));
    const input = screen.getByPlaceholderText(/Mappnamn/i);
    fireEvent.change(input, { target: { value: "Avtal" } });
    fireEvent.click(screen.getByRole("button", { name: /Skapa/i }));
    expect(mutationStubs.createFolder.mutate).toHaveBeenCalledWith({
      matterId: "m1",
      name: "Avtal",
      parentId: null,
    });
  });

  it("anropar inte createFolder när namnet är tomt/whitespace", () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny mapp/i }));
    const input = screen.getByPlaceholderText(/Mappnamn/i);
    // required-attributet stoppar tomt namn vid submit; men whitespace kan tas in
    fireEvent.change(input, { target: { value: "   " } });
    const form = input.closest("form")!;
    fireEvent.submit(form);
    expect(mutationStubs.createFolder.mutate).not.toHaveBeenCalled();
  });

  it("Avbryt stänger Ny mapp-formuläret", () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny mapp/i }));
    expect(screen.getByPlaceholderText(/Mappnamn/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Avbryt/i }));
    expect(screen.queryByPlaceholderText(/Mappnamn/i)).not.toBeInTheDocument();
  });

  it("klick på mappnamnet kollapsar och expanderar mappen", () => {
    treeQuery.data = {
      folders: [baseFolder()],
      documents: [baseDoc({ folderId: "f1", fileName: "barn.pdf" })],
    };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText("barn.pdf")).toBeInTheDocument();
    // Klicka på mappnamnet (det är en knapp inom raden)
    fireEvent.click(screen.getByText("Inlagor"));
    expect(screen.queryByText("barn.pdf")).not.toBeInTheDocument();
    // Klicka igen → expanderas
    fireEvent.click(screen.getByText("Inlagor"));
    expect(screen.getByText("barn.pdf")).toBeInTheDocument();
  });

  it("klick på Byt namn aktiverar inline-rename-input", () => {
    treeQuery.data = { folders: [baseFolder()], documents: [] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByLabelText("Mappåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Byt namn/i }));
    // En input ska nu finnas (med mappnamnet förifyllt)
    const input = screen.getByDisplayValue("Inlagor");
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Avtal" } });
    const form = input.closest("form")!;
    fireEvent.submit(form);
    expect(mutationStubs.renameFolder.mutate).toHaveBeenCalledWith({
      id: "f1",
      name: "Avtal",
    });
  });

  it("Ta bort-mapp visar confirm — vid OK körs deleteFolder", () => {
    treeQuery.data = { folders: [baseFolder()], documents: [] };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByLabelText("Mappåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Ta bort$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mutationStubs.deleteFolder.mutate).toHaveBeenCalledWith({ id: "f1" });
    confirmSpy.mockRestore();
  });

  it("Ta bort-mapp avbryts när confirm returnerar false", () => {
    treeQuery.data = { folders: [baseFolder()], documents: [] };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByLabelText("Mappåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Ta bort$/i }));
    expect(mutationStubs.deleteFolder.mutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("Ta bort-dokument confirm + delete", () => {
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Ta bort$/i }));
    expect(mutationStubs.delete.mutate).toHaveBeenCalledWith({ id: "d1" });
    confirmSpy.mockRestore();
  });

  it("klick på Analysera triggar reanalyze-mutation", () => {
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Analysera/i }));
    expect(mutationStubs.analyze.mutate).toHaveBeenCalledWith({ documentId: "d1" });
  });

  it("uppladdning utan working copy skickar textens innehåll till suggestFromText (#988)", async () => {
    // Utan FSA-handle (mockad till null överst) skrivs filen aldrig till
    // klientens disk — extract-text-jobbet kan alltså aldrig läsa den igen.
    // Bytes:en finns bara i den här uppladdningen; missas de blir panelerna
    // permanent tomma i demon.
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    const file = new File(["Kärande: Anna Andersson 850312-4567"], "stamning.txt", { type: "text/plain" });
    uploadViaButton([file]);

    await waitFor(() => expect(clientMock.document.suggestFromText.mutate).toHaveBeenCalled());
    expect(clientMock.document.suggestFromText.mutate.mock.calls[0]![0]).toMatchObject({
      text: "Kärande: Anna Andersson 850312-4567",
    });
    // Den vanliga vägen (working copy finns) köas oavsett — jobbet är no-op
    // utan handle, och tar över så fort en mapp är vald.
    expect(enqueueTextExtraction).toHaveBeenCalled();
  });

  it("Analysera köar också text-extraktion → kontakt-/händelseförslag (#988)", () => {
    // Analyze-porten köar bara klassificeringen och känner varken filnamn
    // eller sökväg. Utan det här steget analyseras dokumentet om utan att
    // panelerna någonsin fylls.
    treeQuery.data = { folders: [], documents: [baseDoc({ storagePath: "documents/content/a.pdf" })] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Analysera/i }));
    expect(enqueueTextExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1", fileName: "test.pdf", mimeType: "application/pdf", storagePath: "documents/content/a.pdf" }),
    );
  });

  it("dragstart + drop på mapp anropar moveDocument", () => {
    treeQuery.data = { folders: [baseFolder()], documents: [baseDoc()] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    const docCell = screen.getByText("test.pdf").closest("tr")!;
    const folderCell = screen.getByText("Inlagor").closest("tr")!;
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
      types: [] as string[],
      files: [] as File[],
      items: [] as DataTransferItem[],
    };
    fireEvent.dragStart(docCell, { dataTransfer });
    fireEvent.dragOver(folderCell, { dataTransfer });
    fireEvent.drop(folderCell, { dataTransfer });
    expect(mutationStubs.moveDocument.mutate).toHaveBeenCalledWith({
      documentId: "d1",
      folderId: "f1",
    });
  });

  it("drag + drop av mapp på annan mapp anropar moveFolder", () => {
    treeQuery.data = {
      folders: [baseFolder(), baseFolder({ id: "f2", name: "Beslut" })],
      documents: [],
    };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    const f1 = screen.getByText("Inlagor").closest("tr")!;
    const f2 = screen.getByText("Beslut").closest("tr")!;
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
      types: [] as string[],
      files: [] as File[],
      items: [] as DataTransferItem[],
    };
    fireEvent.dragStart(f1, { dataTransfer });
    fireEvent.dragOver(f2, { dataTransfer });
    fireEvent.drop(f2, { dataTransfer });
    expect(mutationStubs.moveFolder.mutate).toHaveBeenCalledWith({
      folderId: "f1",
      targetParentId: "f2",
    });
  });

  it("drop på rot-zonen flyttar dokumentet till null", () => {
    treeQuery.data = {
      folders: [baseFolder()],
      documents: [baseDoc({ folderId: "f1" })],
    };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    const docRow = screen.getByText("test.pdf").closest("tr")!;
    const rootRow = screen.getByText("Rot").closest("tr")!;
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
      types: [] as string[],
      files: [] as File[],
      items: [] as DataTransferItem[],
    };
    fireEvent.dragStart(docRow, { dataTransfer });
    fireEvent.dragOver(rootRow, { dataTransfer });
    fireEvent.drop(rootRow, { dataTransfer });
    expect(mutationStubs.moveDocument.mutate).toHaveBeenCalledWith({
      documentId: "d1",
      folderId: null,
    });
  });

  it("renderar nested mappar och dokument när expanderade", () => {
    treeQuery.data = {
      folders: [
        baseFolder({ id: "p", name: "Parent", parentId: null }),
        baseFolder({ id: "c", name: "Child", parentId: "p" }),
      ],
      documents: [baseDoc({ folderId: "c", fileName: "sub.pdf" })],
    };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.getByText("Parent")).toBeInTheDocument();
    expect(screen.getByText("Child")).toBeInTheDocument();
    expect(screen.getByText("sub.pdf")).toBeInTheDocument();
  });

  it("klick på dokumentnamnet i demo öppnar GH-Pages-blobben (runtime-tier, #651)", async () => {
    // #651: namn-klicket går via openMatterDocument med RUNTIME-tier. I demo →
    // öppna GH-Pages-URL:en (self-hosted skulle i st.f. hämta via servern).
    window.localStorage.setItem("ava.firma", JSON.stringify({ tier: "demo", repo: "ulrik-s/ava-demo" }));
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
      fireEvent.click(screen.getByText("test.pdf"));
      await import("@testing-library/react").then(({ waitFor }) =>
        waitFor(() => expect(openSpy).toHaveBeenCalled(), { timeout: 2000 }),
      );
      expect(String(openSpy.mock.calls[0]![0])).toMatch(/github\.io\/ava-demo\//);
    } finally {
      openSpy.mockRestore();
      window.localStorage.removeItem("ava.firma");
    }
  });

  it("trädvyn har ingen kolumn Storlek och visar ingen filstorlek (#1803)", () => {
    treeQuery.data = {
      folders: [],
      documents: [
        baseDoc({ id: "d-kb", fileName: "kb.pdf", sizeBytes: 5000 }),
        baseDoc({ id: "d-mb", fileName: "mb.pdf", sizeBytes: 5_000_000 }),
        baseDoc({ id: "d-b", fileName: "small.pdf", sizeBytes: 500 }),
      ],
    };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.queryByRole("columnheader", { name: /Storlek/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/5 KB/)).not.toBeInTheDocument();
    expect(screen.queryByText(/4\.8 MB/)).not.toBeInTheDocument();
    expect(screen.queryByText(/500 B/)).not.toBeInTheDocument();
  });
});

describe("DocumentBrowser — flera filer på en gång", () => {
  const pick = uploadViaButton;
  const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });

  it("filväljaren tillåter flera filer", () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(document.querySelector("input[type=file]")!.hasAttribute("multiple")).toBe(true);
  });

  it("laddar upp ALLA valda filer, i tur och ordning (förut bara den första)", async () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    pick([pdf("stamning.pdf"), pdf("svaromal.pdf"), pdf("dom.pdf")]);
    await waitFor(() => expect(mutationStubs.register.mutateAsync).toHaveBeenCalledTimes(3));
    const names = mutationStubs.register.mutateAsync.mock.calls.map((c: readonly unknown[]) => (c[0] as { fileName: string }).fileName);
    expect(names).toEqual(["stamning.pdf", "svaromal.pdf", "dom.pdf"]);
  });

  it("filväljaren töms efter valet, så att samma fil kan väljas igen (#1976)", () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    Object.defineProperty(fileInput(), "value", { value: "C:\\fakepath\\skiss.pdf", writable: true, configurable: true });
    choose([pdf("skiss.pdf")]);
    expect(fileInput().value).toBe("");
  });

  it("+ Ladda upp går genom namnrutan, en fil i taget, i roten (#1976)", async () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    choose([pdf("a.pdf"), pdf("b.pdf")]);
    expect(screen.getByRole("dialog", { name: "Namnge dokumentet" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("a")).toBeInTheDocument();
    expect(mutationStubs.register.mutateAsync).not.toHaveBeenCalled();
    fireEvent.change(screen.getByDisplayValue("a"), { target: { value: "Avtal" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(screen.getByDisplayValue("b")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    expect(screen.queryByRole("dialog", { name: "Namnge dokumentet" })).not.toBeInTheDocument();
    await waitFor(() => expect(mutationStubs.register.mutateAsync).toHaveBeenCalledTimes(2));
    const calls = mutationStubs.register.mutateAsync.mock.calls.map((c: readonly unknown[]) => c[0]);
    expect(calls[0]).toMatchObject({ fileName: "Avtal.pdf", matterId: "m1" });
    expect(calls[0]).not.toHaveProperty("folderId");
    expect(calls[1]).toMatchObject({ fileName: "b.pdf" });
  });

  it("Avbryt i namnrutan hoppar över filen (#1976)", async () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    choose([pdf("a.pdf"), pdf("b.pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.getByDisplayValue("b")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(mutationStubs.register.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutationStubs.register.mutateAsync.mock.calls[0]?.[0]).toMatchObject({ fileName: "b.pdf" });
  });

  it("utan valda filer öppnas ingen namnruta", () => {
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    Object.defineProperty(fileInput(), "files", { value: null, configurable: true });
    fireEvent.change(fileInput());
    expect(screen.queryByRole("dialog", { name: "Namnge dokumentet" })).not.toBeInTheDocument();
  });

  it("en fil som fallerar stoppar inte de andra, och felet säger vilken fil", async () => {
    mutationStubs.register.mutateAsync
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("för stor"))
      .mockResolvedValueOnce({});
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    pick([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]);
    await waitFor(() => expect(screen.getByText(/b\.pdf: för stor/)).toBeInTheDocument());
    expect(mutationStubs.register.mutateAsync).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/a\.pdf:/)).not.toBeInTheDocument();
  });
});

/**
 * #1796: listvyn (standardvyn) visar pågående uppladdningar som träd-vyn gör,
 * även med ett filter aktivt, och raden byts mot den riktiga när den är klar.
 */
describe("DocumentBrowser — listvyn visar pågående uppladdningar (#1796)", () => {
  const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });
  const pick = uploadViaButton;
  /** register hänger tills testet släpper det, så uppladdningen syns som pågående. */
  function holdRegister(): () => void {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mutationStubs.register.mutateAsync = vi.fn(async () => { await gate; return {}; });
    return () => release();
  }
  const nameButton = (name: string): HTMLElement => screen.getByRole("button", { name: new RegExp(name.replace(".", "\\.")) });

  beforeEach(() => { window.localStorage.setItem("ava.documents.viewMode", "list"); });
  afterEach(() => { mutationStubs.register.mutateAsync = vi.fn().mockResolvedValue({}); });

  it("en pågående uppladdning syns i listvyn, gråtonad och ej klickbar, även med ett filter aktivt", async () => {
    const release = holdRegister();
    treeQuery.data = { folders: [], documents: [baseDoc({ direction: "UTGAENDE" })] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    fireEvent.change(screen.getByLabelText("Riktning"), { target: { value: "INKOMMANDE" } });
    expect(screen.queryByText("test.pdf")).not.toBeInTheDocument();
    pick([pdf("skiss.pdf")]);
    await waitFor(() => expect(nameButton("skiss.pdf")).toBeDisabled());
    expect(nameButton("skiss.pdf").closest(".opacity-60")).not.toBeNull();
    release();
    await waitFor(() => expect(screen.queryByText("skiss.pdf")).not.toBeInTheDocument());
  });

  it("raden byts mot den riktiga när uppladdningen är klar", async () => {
    const release = holdRegister();
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    pick([pdf("skiss.pdf")]);
    await waitFor(() => expect(nameButton("skiss.pdf")).toBeDisabled());
    treeQuery.data = { folders: [], documents: [baseDoc({ id: "d-skiss", fileName: "skiss.pdf" })] };
    release();
    await waitFor(() => expect(nameButton("skiss.pdf")).toBeEnabled());
    expect(screen.getAllByText("skiss.pdf")).toHaveLength(1);
    expect(nameButton("skiss.pdf").closest(".opacity-60")).toBeNull();
  });

  it("\"Analysera (AI)\" i listvyn är spärrad medan analysen pågår", () => {
    mutationStubs.analyze.isPending = true;
    try {
      treeQuery.data = { folders: [], documents: [baseDoc()] };
      render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
      fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
      expect(screen.getByRole("menuitem", { name: /Analysera \(AI\)/ })).toBeDisabled();
    } finally {
      mutationStubs.analyze.isPending = false;
    }
  });

  it("listvyn visar \"⏳ analyseras…\" när Analysera körs", () => {
    treeQuery.data = { folders: [], documents: [baseDoc({ analyzedAt: new Date("2026-04-16") })] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(screen.queryByText("⏳ analyseras…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    fireEvent.click(screen.getByText("Analysera (AI)"));
    expect(screen.getByText("⏳ analyseras…")).toBeInTheDocument();
  });
});

// #1615: filer som släpps utifrån (från datorn eller ett mejlprogram).
describe("DocumentBrowser — släpp filer utifrån", () => {
  const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });
  const outside = (files: File[], types: string[] = ["Files"]) => ({
    effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: vi.fn(), types, files, items: [] as DataTransferItem[],
  });
  /** dragover + drop som webbläsaren skickar; returnerar om dragover släpptes igenom (inte förhindrad). */
  function drop(el: Element, dataTransfer: ReturnType<typeof outside>): boolean {
    const passed = fireEvent.dragOver(el, { dataTransfer });
    fireEvent.drop(el, { dataTransfer });
    return passed;
  }
  const rowOf = (text: string): HTMLElement => {
    const tr = screen.getByText(text).closest("tr");
    if (!tr) throw new Error(`ingen rad för ${text}`);
    return tr;
  };
  const dialog = () => screen.queryByRole("dialog", { name: "Namnge dokumentet" });
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Spara" }));
  const registered = (): unknown[] => mutationStubs.register.mutateAsync.mock.calls.map((c: readonly unknown[]) => c[0]);
  const renderTree = () => {
    treeQuery.data = { folders: [baseFolder()], documents: [baseDoc()] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
  };

  it("fil släppt på en mapp → namnrutan, Spara → register i mappen", async () => {
    renderTree();
    expect(drop(rowOf("Inlagor"), outside([pdf("skiss.pdf")]))).toBe(false);
    expect(dialog()).toBeInTheDocument();
    save();
    await waitFor(() => expect(mutationStubs.register.mutateAsync).toHaveBeenCalledTimes(1));
    expect(registered()[0]).toMatchObject({ fileName: "skiss.pdf", folderId: "f1", matterId: "m1" });
  });

  it("fil släppt på rot-raden → roten", async () => {
    renderTree();
    drop(rowOf("Rot"), outside([pdf("skiss.pdf")]));
    save();
    await waitFor(() => expect(mutationStubs.register.mutateAsync).toHaveBeenCalledTimes(1));
    expect(registered()[0]).not.toHaveProperty("folderId");
  });

  it("fil släppt på ett dokument (tom yta i vyn) → roten; webbläsaren öppnar den inte", async () => {
    renderTree();
    expect(drop(rowOf("test.pdf"), outside([pdf("bilaga.pdf")]))).toBe(false);
    save();
    await waitFor(() => expect(mutationStubs.register.mutateAsync).toHaveBeenCalledTimes(1));
    expect(registered()[0]).not.toHaveProperty("folderId");
  });

  it("två filer → två namnrutor i tur och ordning", async () => {
    renderTree();
    drop(rowOf("Inlagor"), outside([pdf("a.pdf"), pdf("b.pdf")]));
    expect(screen.getByDisplayValue("a")).toBeInTheDocument();
    save();
    expect(screen.getByDisplayValue("b")).toBeInTheDocument();
    save();
    await waitFor(() => expect(mutationStubs.register.mutateAsync).toHaveBeenCalledTimes(2));
    expect(registered().map((r) => (r as { fileName: string }).fileName)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("släpp utan filer (bara text) → beskedet, ingen namnruta, ingen register", () => {
    renderTree();
    drop(rowOf("Inlagor"), outside([], ["text/plain"]));
    expect(screen.getByText(/Det gick inte att läsa in det du släppte/)).toBeInTheDocument();
    expect(dialog()).not.toBeInTheDocument();
    expect(mutationStubs.register.mutateAsync).not.toHaveBeenCalled();
  });

  it("AVA-dokument till mapp → moveDocument som förut, ingen namnruta", () => {
    renderTree();
    const dataTransfer = outside([], []);
    fireEvent.dragStart(rowOf("test.pdf"), { dataTransfer });
    drop(rowOf("Inlagor"), dataTransfer);
    expect(mutationStubs.moveDocument.mutate).toHaveBeenCalledWith({ documentId: "d1", folderId: "f1" });
    expect(dialog()).not.toBeInTheDocument();
  });

  it("AVA-rad släppt utanför mapparna: inget händer (som förut)", () => {
    renderTree();
    const dataTransfer = outside([], ["text/plain"]);
    const row = rowOf("test.pdf");
    fireEvent.dragStart(row, { dataTransfer });
    expect(drop(row, dataTransfer)).toBe(true);
    expect(mutationStubs.moveDocument.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText(/Det gick inte att läsa in/)).not.toBeInTheDocument();
  });

  it("släpp-markeringen: mappen respektive roten markeras och släcks vid dragleave", () => {
    renderTree();
    const folder = rowOf("Inlagor");
    fireEvent.dragOver(folder, { dataTransfer: outside([]) });
    expect(folder.className).toContain("bg-blue-50");
    fireEvent.dragLeave(folder);
    expect(folder.className).not.toContain("bg-blue-50");
    const doc = rowOf("test.pdf");
    fireEvent.dragOver(doc, { dataTransfer: outside([]) });
    expect(rowOf("Rot").className).toContain("bg-blue-50");
  });

  it("listvyn: fil släppt i listan → roten, med markering under dragningen", async () => {
    window.localStorage.setItem("ava.documents.viewMode", "list");
    treeQuery.data = { folders: [baseFolder()], documents: [baseDoc({ folderId: "f1" })] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    const cell = screen.getByText("test.pdf");
    fireEvent.dragOver(cell, { dataTransfer: outside([]) });
    expect(document.querySelector(".ring-blue-300")).not.toBeNull();
    drop(cell, outside([pdf("skiss.pdf")]));
    expect(document.querySelector(".ring-blue-300")).toBeNull();
    save();
    await waitFor(() => expect(mutationStubs.register.mutateAsync).toHaveBeenCalledTimes(1));
    expect(registered()[0]).not.toHaveProperty("folderId");
  });

  it("listvyn: en kolumndragning (inte utifrån) rörs inte", () => {
    window.localStorage.setItem("ava.documents.viewMode", "list");
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    render(<DocumentBrowser matterId={asId<"MatterId">("m1")} />);
    expect(drop(screen.getByText("test.pdf"), outside([], ["text/x-col"]))).toBe(true);
    expect(screen.queryByText(/Det gick inte att läsa in/)).not.toBeInTheDocument();
  });
});

/**
 * #1228: ett nytt ärende visar standardmapparna direkt. Ärendet skapas via den
 * RIKTIGA `matter.create`, trädet hämtas via den riktiga `document.tree` —
 * browsern får exakt det svar servern ger.
 */
describe("DocumentBrowser — nytt ärende har standardmappar (#1228)", () => {
  it("visar rotmapparna och Domstols undermappar", async () => {
    const { appRouter } = await import("@/lib/server/routers/_app");
    const { buildContext } = await import("@/lib/server/build-context");
    const { DemoDataStore } = await import("@/lib/server/data-store/DemoDataStore");
    const { noopPorts } = await import("@/lib/server/adapters/noop-ports");
    const ds = new DemoDataStore({
      organizations: [{ id: "org-a", name: "X" }],
      users: [{ id: "user-1", organizationId: "org-a", email: "a@b.com", name: "T", role: "LAWYER" }],
      matters: [], contacts: [], matterContacts: [],
    }, async () => { /* writable */ });
    const principal = {
      id: asId<"UserId">("user-1"), email: "a@b.com", name: "T", role: "LAWYER" as const,
      organizationId: asId<"OrganizationId">("org-a"),
    };
    const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal }));
    const matter = await caller.matter.create({ title: "Nytt ärende" });
    const tree = await caller.document.tree({ matterId: asId<"MatterId">(matter.id) });
    treeQuery.data = { folders: tree.folders, documents: tree.documents };
    render(<DocumentBrowser matterId={asId<"MatterId">(matter.id)} />);
    // Mapparna är expanderade från start → hela trädet syns. ("Domstol" finns
    // även som <option> i mottagarfiltret — räkna bara trädets noder.)
    const inTree = (name: string) => screen.getAllByText(name).filter((el) => el.tagName !== "OPTION");
    for (const name of [
      "Faktura", "Domstol", "Beslut", "Korrespondens", "Avtal", "Övrigt",
      "Kallelse", "Föreläggande", "Förordnande", "Inlagor",
    ]) {
      expect(inTree(name)).toHaveLength(1);
    }
  });
});
