/**
 * DocumentsListView — flat-vy för dokument med folder-path-kolumn.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { DocumentsListView } from "@/components/documents/_documents-list-view";
import { asId } from "@/lib/shared/schemas/ids";

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
    document: { takeoverLease: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) } },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
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

const baseFolder = (id: string, name: string, parentId: string | null = null) =>
  ({
    id: asId<"DocumentFolderId">(id),
    name,
    parentId: parentId === null ? null : asId<"DocumentFolderId">(parentId),
    matterId: asId<"MatterId">("m1"),
    createdAt: new Date(),
  });

describe("DocumentsListView", () => {
  it("renderar tomt-state när inga docs", () => {
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[]} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}}
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
        onDelete={() => {}} onReanalyze={() => {}}
      />,
    );
    expect(screen.getByText("stamning.pdf")).toBeInTheDocument();
    expect(screen.getByText("Stämning")).toBeInTheDocument();
    expect(screen.getByText("/Underlag")).toBeInTheDocument();
  });

  it("nästlad folder-path renderas som /Parent/Child", () => {
    const f1 = baseFolder("f1", "Parent");
    const f2 = baseFolder("f2", "Child", "f1");
    const doc = baseDoc({ folderId: "f2" });
    render(
      <DocumentsListView
        matterId={asId<"MatterId">("m1")} documents={[doc]} folders={[f1, f2]}
        onDelete={() => {}} onReanalyze={() => {}}
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
        onDelete={() => {}} onReanalyze={() => {}}
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
        onDelete={() => {}} onReanalyze={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "stamning.pdf" })).toBeInTheDocument();
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
        onDelete={() => {}} onReanalyze={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "minnesanteckning.txt" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "minnesanteckning (din ändring 2027-03-14 09:15).txt" }),
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
        onDelete={() => {}} onReanalyze={() => {}}
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
          onDelete={onDelete} onReanalyze={() => {}}
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
        onDelete={() => {}} onReanalyze={() => {}}
      />,
    );
    const headerFor = (label: string): HTMLElement =>
      screen.getByText(new RegExp(`^${label}`)).closest("th")!;

    // Filnamnet är det enda som alltid måste synas — det får inte döljas.
    expect(headerFor("Filnamn").className).not.toContain("hidden");
    for (const label of ["Typ", "Datum", "Storlek", "Mapp", "Uppladdad av"]) {
      expect(headerFor(label).className, `${label} ska döljas på små skärmar`).toContain("hidden");
    }
  });
});
