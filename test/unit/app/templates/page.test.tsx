/**
 * Test för TemplatesPage — listrendering, gruppering, ta-bort-dialog.
 */

import { act, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import TemplatesPage from "@/app/templates/page";
import { rowOrder, rowWith, sortColumn } from "../../../helpers/data-table";
import { NEW_TRPC_BINDING, renderWithNewTrpc } from "../../../helpers/trpc-classic-mock";

const templatesQuery = {
  data: undefined as Array<Record<string, unknown>> | undefined,
  isLoading: false,
};
const utilsMock = {
  documentTemplate: { list: { invalidate: vi.fn() } },
  prefs: { get: { invalidate: vi.fn() } },
};
const deleteMutate = vi.fn();
const deleteState = { isPending: false };
/** onSuccess från documentTemplate.delete — testet anropar den som servern hade gjort. */
let templateDeleted: (() => void) | undefined;
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/client/trpc", () => ({
  ...NEW_TRPC_BINDING,
  trpc: {
    useUtils: () => utilsMock,
    documentTemplate: {
      list: { useQuery: () => templatesQuery },
      delete: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          templateDeleted = opts?.onSuccess;
          return { mutate: deleteMutate, isPending: deleteState.isPending };
        },
      },
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
  templatesQuery.data = undefined;
  templatesQuery.isLoading = false;
  deleteState.isPending = false;
});

describe("TemplatesPage", () => {
  it("renderar rubrik och Ny mall-länk", () => {
    templatesQuery.data = [];
    renderWithNewTrpc(<TemplatesPage />);
    expect(screen.getByRole("heading", { name: /Dokumentmallar/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Ny mall/i }).length).toBeGreaterThan(0);
  });

  it("visar laddartext", () => {
    templatesQuery.isLoading = true;
    renderWithNewTrpc(<TemplatesPage />);
    expect(screen.getByText(/Laddar mallar/i)).toBeInTheDocument();
  });

  it("visar tomt-läge om inga mallar finns", () => {
    templatesQuery.data = [];
    renderWithNewTrpc(<TemplatesPage />);
    expect(screen.getByText(/Inga mallar än/i)).toBeInTheDocument();
  });

  it("listar mallar grupperat efter kategori", () => {
    templatesQuery.data = [
      {
        id: "t1",
        name: "Fullmakt",
        description: "Klientfullmakt",
        category: "Fullmakter",
        createdBy: { name: "Anna" },
        updatedAt: new Date("2026-01-15").toISOString(),
      },
      {
        id: "t2",
        name: "Avtal",
        description: null,
        category: null,
        createdBy: { name: "Bo" },
        updatedAt: new Date("2026-01-15").toISOString(),
      },
    ];
    renderWithNewTrpc(<TemplatesPage />);
    expect(screen.getByText("Fullmakt")).toBeInTheDocument();
    expect(screen.getByText("Avtal")).toBeInTheDocument();
    expect(screen.getByText("Fullmakter")).toBeInTheDocument();
    expect(screen.getByText("Okategoriserade")).toBeInTheDocument();
  });

  it("öppnar bekräftelsedialog och anropar delete", () => {
    templatesQuery.data = [
      {
        id: "t1",
        name: "Fullmakt",
        description: null,
        category: "X",
        createdBy: { name: "A" },
        updatedAt: new Date().toISOString(),
      },
    ];
    renderWithNewTrpc(<TemplatesPage />);
    fireEvent.click(screen.getByTitle("Ta bort"));
    expect(screen.getByText(/Ta bort mall\?/i)).toBeInTheDocument();
    // Click confirm (the second "Ta bort" button in the dialog)
    const removeButtons = screen.getAllByRole("button", { name: /Ta bort/i });
    fireEvent.click(removeButtons[removeButtons.length - 1]!);
    expect(deleteMutate).toHaveBeenCalledWith({ id: "t1" });
  });

  it("stänger dialogen vid Avbryt", () => {
    templatesQuery.data = [
      {
        id: "t1",
        name: "Fullmakt",
        description: null,
        category: "X",
        createdBy: { name: "A" },
        updatedAt: new Date().toISOString(),
      },
    ];
    renderWithNewTrpc(<TemplatesPage />);
    fireEvent.click(screen.getByTitle("Ta bort"));
    expect(screen.getByText(/Ta bort mall\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Avbryt/i }));
    expect(screen.queryByText(/Ta bort mall\?/i)).not.toBeInTheDocument();
  });
});

// ── Kolumnerna, radklicket och borttagningens svar (#1904) ──────────────

/** Tre mallar där varje kolumn ger en egen ordning. */
const sortableTemplates = (): Array<Record<string, unknown>> => [
  { id: "a", name: "Alfa", category: "Processer", description: "Ccc", createdBy: { name: "Bo" },
    updatedAt: "2026-03-01T00:00:00.000Z" },
  { id: "b", name: "Beta", category: null, description: null, createdBy: null,
    updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "c", name: "Gamma", category: "Avtal", description: "Aaa", createdBy: { name: "Ada" },
    updatedAt: "2026-02-01T00:00:00.000Z" },
];

describe("TemplatesPage — kolumnerna sorterar på det som visas (#1904)", () => {
  beforeEach(() => {
    templatesQuery.data = sortableTemplates();
  });

  const names = ["Alfa", "Beta", "Gamma"];

  it("Namn, Kategori och Beskrivning", () => {
    renderWithNewTrpc(<TemplatesPage />);
    sortColumn("Namn", "desc");
    expect(rowOrder(names)).toEqual(["Gamma", "Beta", "Alfa"]);
    sortColumn("Kategori", "asc");
    expect(rowOrder(names)).toEqual(["Gamma", "Beta", "Alfa"]);
    sortColumn("Beskrivning", "asc");
    expect(rowOrder(names)).toEqual(["Beta", "Gamma", "Alfa"]);
  });

  it("Skapad av och Uppdaterad", () => {
    renderWithNewTrpc(<TemplatesPage />);
    sortColumn("Skapad av", "desc");
    expect(rowOrder(names)).toEqual(["Alfa", "Gamma", "Beta"]);
    sortColumn("Uppdaterad", "asc");
    expect(rowOrder(names)).toEqual(["Beta", "Gamma", "Alfa"]);
  });
});

describe("TemplatesPage — radklick och borttagning (#1904)", () => {
  it("klick på raden öppnar mallen för redigering", () => {
    templatesQuery.data = sortableTemplates();
    renderWithNewTrpc(<TemplatesPage />);
    fireEvent.click(rowWith("Gamma"));
    expect(routerPush).toHaveBeenCalledWith("/templates/__shell__/edit/?id=c");
  });

  it("klick på Ta bort öppnar inte mallen", () => {
    templatesQuery.data = sortableTemplates();
    renderWithNewTrpc(<TemplatesPage />);
    fireEvent.click(screen.getAllByTitle("Ta bort")[0] as HTMLElement);
    expect(routerPush).not.toHaveBeenCalled();
    expect(screen.getByText(/Ta bort mall\?/i)).toBeInTheDocument();
  });

  it("när mallen tagits bort stängs dialogen och listan laddas om", () => {
    templatesQuery.data = sortableTemplates();
    renderWithNewTrpc(<TemplatesPage />);
    fireEvent.click(screen.getAllByTitle("Ta bort")[0] as HTMLElement);
    act(() => templateDeleted?.());
    expect(utilsMock.documentTemplate.list.invalidate).toHaveBeenCalled();
    expect(screen.queryByText(/Ta bort mall\?/i)).not.toBeInTheDocument();
  });

  it("medan borttagningen pågår är knappen låst", () => {
    templatesQuery.data = sortableTemplates();
    deleteState.isPending = true;
    renderWithNewTrpc(<TemplatesPage />);
    fireEvent.click(screen.getAllByTitle("Ta bort")[0] as HTMLElement);
    expect(screen.getByRole("button", { name: "Tar bort…" })).toBeDisabled();
  });
});
