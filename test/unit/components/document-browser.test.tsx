/**
 * Test för DocumentBrowser — träd-rendering, ikoner, badges, tomtillstånd.
 *
 * Drag-and-drop testas inte i detalj här (testas i E2E) men bas-renderingen
 * och de flesta interaktiva UI-flöden täcks: + Ny mapp, + Ladda upp, "..."
 * etc.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentBrowser } from "@/components/documents/document-browser";

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

const utilsMock = {
  document: {
    tree: { invalidate: vi.fn(), fetch: vi.fn().mockResolvedValue({ folders: [], documents: [] }) },
    pendingSuggestionsGrouped: { invalidate: vi.fn() },
    pendingSuggestions: { invalidate: vi.fn() },
  },
  matter: { getById: { invalidate: vi.fn() } },
  prefs: { get: { invalidate: vi.fn() } },
};

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
      createFolder: { useMutation: () => mutationStubs.createFolder },
      renameFolder: { useMutation: () => mutationStubs.renameFolder },
      deleteFolder: { useMutation: () => mutationStubs.deleteFolder },
      moveDocument: { useMutation: () => mutationStubs.moveDocument },
      moveFolder: { useMutation: () => mutationStubs.moveFolder },
      delete: { useMutation: () => mutationStubs.delete },
      analyze: { useMutation: () => mutationStubs.analyze },
      register: { useMutation: () => mutationStubs.register },
    },
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

beforeEach(() => {
  vi.clearAllMocks();
  // Tester nedan validerar träd-vyn explicit (+Ny mapp, drag-and-drop osv.);
  // tvinga träd-läget innan varje render (default är annars "list").
  window.localStorage.setItem("ava.documents.viewMode", "tree");
  treeQuery.data = { folders: [], documents: [] };
  mutationStubs.createFolder.mutate = vi.fn();
  mutationStubs.renameFolder.mutate = vi.fn();
  mutationStubs.deleteFolder.mutate = vi.fn();
  mutationStubs.moveDocument.mutate = vi.fn();
  mutationStubs.moveFolder.mutate = vi.fn();
  mutationStubs.delete.mutate = vi.fn();
  mutationStubs.analyze.mutate = vi.fn();
});

const baseDoc = (overrides: Partial<Doc> = {}): Doc => ({
  id: "d1",
  fileName: "test.pdf",
  mimeType: "application/pdf",
  fileSize: 1024,
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

describe("DocumentBrowser", () => {
  it("visar tomtillstånd när inga mappar/dokument finns", () => {
    render(<DocumentBrowser matterId="m1" />);
    expect(screen.getByText(/Inga dokument eller mappar/i)).toBeInTheDocument();
  });

  it("renderar dokumentnamn för loose root-fil", () => {
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    render(<DocumentBrowser matterId="m1" />);
    expect(screen.getByText("test.pdf")).toBeInTheDocument();
  });

  it("visar AI-extraherad titel istället för filnamn när satt", () => {
    treeQuery.data = {
      folders: [],
      documents: [baseDoc({ title: "Stämningsansökan 2026-0001", documentType: "Stämning" })],
    };
    render(<DocumentBrowser matterId="m1" />);
    expect(screen.getByText("Stämningsansökan 2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Stämning")).toBeInTheDocument();
  });

  it("renderar mappar i trädet", () => {
    treeQuery.data = { folders: [baseFolder()], documents: [] };
    render(<DocumentBrowser matterId="m1" />);
    expect(screen.getByText("Inlagor")).toBeInTheDocument();
  });

  it("öppnar Ny mapp-form vid klick", () => {
    render(<DocumentBrowser matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny mapp/i }));
    expect(screen.getByPlaceholderText(/Mappnamn/i)).toBeInTheDocument();
  });

  it("visar analys-fel-badge när analysisError satt", () => {
    treeQuery.data = {
      folders: [],
      documents: [baseDoc({ analysisError: "Tika fail" })],
    };
    render(<DocumentBrowser matterId="m1" />);
    expect(screen.getByText(/analys-fel/i)).toBeInTheDocument();
  });

  it("visar 'analyseras…'-badge för dokument som är < 5 min gamla", () => {
    const recent = new Date(Date.now() - 60_000); // 1 min sedan
    treeQuery.data = {
      folders: [],
      documents: [baseDoc({ createdAt: recent })],
    };
    render(<DocumentBrowser matterId="m1" />);
    expect(screen.getByText(/analyseras/i)).toBeInTheDocument();
  });

  it("visar inte analyseras-badge för gamla, oanalyserade dokument", () => {
    const old = new Date("2025-01-01");
    treeQuery.data = { folders: [], documents: [baseDoc({ createdAt: old })] };
    render(<DocumentBrowser matterId="m1" />);
    expect(screen.queryByText(/analyseras/i)).not.toBeInTheDocument();
  });

  it("har Visa, Ladda ner, Analysera, Ta bort i kebab-menyn på varje fil", () => {
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    render(<DocumentBrowser matterId="m1" />);
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    expect(screen.getByText("Visa")).toBeInTheDocument();
    expect(screen.getByText("Ladda ner")).toBeInTheDocument();
    expect(screen.getByText(/Analysera/)).toBeInTheDocument();
    expect(screen.getByText("Ta bort")).toBeInTheDocument();
  });

  it("submittar Ny mapp-formuläret med mappnamn", () => {
    render(<DocumentBrowser matterId="m1" />);
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
    render(<DocumentBrowser matterId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: /\+ Ny mapp/i }));
    const input = screen.getByPlaceholderText(/Mappnamn/i);
    // required-attributet stoppar tomt namn vid submit; men whitespace kan tas in
    fireEvent.change(input, { target: { value: "   " } });
    const form = input.closest("form")!;
    fireEvent.submit(form);
    expect(mutationStubs.createFolder.mutate).not.toHaveBeenCalled();
  });

  it("Avbryt stänger Ny mapp-formuläret", () => {
    render(<DocumentBrowser matterId="m1" />);
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
    render(<DocumentBrowser matterId="m1" />);
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
    render(<DocumentBrowser matterId="m1" />);
    fireEvent.click(screen.getByLabelText("Mappåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Byt namn/i }));
    // En input ska nu finnas (med mappnamnet förifyllt)
    const input = screen.getByDisplayValue("Inlagor") as HTMLInputElement;
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
    render(<DocumentBrowser matterId="m1" />);
    fireEvent.click(screen.getByLabelText("Mappåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Ta bort$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mutationStubs.deleteFolder.mutate).toHaveBeenCalledWith({ id: "f1" });
    confirmSpy.mockRestore();
  });

  it("Ta bort-mapp avbryts när confirm returnerar false", () => {
    treeQuery.data = { folders: [baseFolder()], documents: [] };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DocumentBrowser matterId="m1" />);
    fireEvent.click(screen.getByLabelText("Mappåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Ta bort$/i }));
    expect(mutationStubs.deleteFolder.mutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("Ta bort-dokument confirm + delete", () => {
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DocumentBrowser matterId="m1" />);
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Ta bort$/i }));
    expect(mutationStubs.delete.mutate).toHaveBeenCalledWith({ id: "d1" });
    confirmSpy.mockRestore();
  });

  it("klick på Analysera triggar reanalyze-mutation", () => {
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    render(<DocumentBrowser matterId="m1" />);
    fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Analysera/i }));
    expect(mutationStubs.analyze.mutate).toHaveBeenCalledWith({ documentId: "d1" });
  });

  it("dragstart + drop på mapp anropar moveDocument", () => {
    treeQuery.data = { folders: [baseFolder()], documents: [baseDoc()] };
    render(<DocumentBrowser matterId="m1" />);
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
    render(<DocumentBrowser matterId="m1" />);
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
    render(<DocumentBrowser matterId="m1" />);
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
    render(<DocumentBrowser matterId="m1" />);
    expect(screen.getByText("Parent")).toBeInTheDocument();
    expect(screen.getByText("Child")).toBeInTheDocument();
    expect(screen.getByText("sub.pdf")).toBeInTheDocument();
  });

  it("klick på dokumentnamnet i self-hosted utan FSA-handle → alert om saknad working copy", async () => {
    // Self-hosted i jsdom har ingen indexedDB-handle → openDocument:s
    // notifyError-gren körs istället för att fetcha ett api som inte finns.
    treeQuery.data = { folders: [], documents: [baseDoc()] };
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<DocumentBrowser matterId="m1" />);
    fireEvent.click(screen.getByText("test.pdf"));
    // openDocument är async + dynamic-import:ar två moduler → vänta med waitFor
    await import("@testing-library/react").then(({ waitFor }) =>
      waitFor(() => expect(alertSpy).toHaveBeenCalled(), { timeout: 1000 }),
    );
    expect(alertSpy.mock.calls[0][0]).toMatch(/working copy/i);
    alertSpy.mockRestore();
  });

  it("formaterar filstorlek korrekt (KB, MB)", () => {
    treeQuery.data = {
      folders: [],
      documents: [
        baseDoc({ id: "d-kb", fileName: "kb.pdf", fileSize: 5000 }),
        baseDoc({ id: "d-mb", fileName: "mb.pdf", fileSize: 5_000_000 }),
        baseDoc({ id: "d-b", fileName: "small.pdf", fileSize: 500 }),
      ],
    };
    render(<DocumentBrowser matterId="m1" />);
    expect(screen.getByText(/5 KB/)).toBeInTheDocument();
    expect(screen.getByText(/4\.8 MB/)).toBeInTheDocument();
    expect(screen.getByText(/500 B/)).toBeInTheDocument();
  });
});
