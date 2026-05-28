/**
 * Test för TemplatesPage — listrendering, gruppering, ta-bort-dialog.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TemplatesPage from "@/app/templates/page";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => utilsMock,
    documentTemplate: {
      list: { useQuery: () => templatesQuery },
      delete: {
        useMutation: () => ({ mutate: deleteMutate, isPending: deleteState.isPending }),
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
    render(<TemplatesPage />);
    expect(screen.getByRole("heading", { name: /Dokumentmallar/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Ny mall/i }).length).toBeGreaterThan(0);
  });

  it("visar laddartext", () => {
    templatesQuery.isLoading = true;
    render(<TemplatesPage />);
    expect(screen.getByText(/Laddar mallar/i)).toBeInTheDocument();
  });

  it("visar tomt-läge om inga mallar finns", () => {
    templatesQuery.data = [];
    render(<TemplatesPage />);
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
    render(<TemplatesPage />);
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
    render(<TemplatesPage />);
    fireEvent.click(screen.getByTitle("Ta bort"));
    expect(screen.getByText(/Ta bort mall\?/i)).toBeInTheDocument();
    // Click confirm (the second "Ta bort" button in the dialog)
    const removeButtons = screen.getAllByRole("button", { name: /Ta bort/i });
    fireEvent.click(removeButtons[removeButtons.length - 1]);
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
    render(<TemplatesPage />);
    fireEvent.click(screen.getByTitle("Ta bort"));
    expect(screen.getByText(/Ta bort mall\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Avbryt/i }));
    expect(screen.queryByText(/Ta bort mall\?/i)).not.toBeInTheDocument();
  });
});
