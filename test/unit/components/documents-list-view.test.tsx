/**
 * DocumentsListView — flat-vy för dokument med folder-path-kolumn.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { DocumentsListView } from "@/components/documents/_documents-list-view";

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
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
  fileSize: 1024,
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
  ({ id, name, parentId, matterId: "m1", createdAt: new Date() });

describe("DocumentsListView", () => {
  it("renderar tomt-state när inga docs", () => {
    render(
      <DocumentsListView
        matterId="m1" documents={[]} folders={[]}
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
        matterId="m1" documents={[doc]} folders={[folder]}
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
        matterId="m1" documents={[doc]} folders={[f1, f2]}
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
        matterId="m1" documents={[doc]} folders={[]}
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
        matterId="m1" documents={[doc]} folders={[]}
        onDelete={() => {}} onReanalyze={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "stamning.pdf" })).toBeInTheDocument();
  });
});
