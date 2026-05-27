/**
 * Test: DocumentRow:s actions ligger nu i en kebab-meny (⋮). Guarden för
 * isUploading=true ska göra att menyn INTE går att öppna (trigger disabled)
 * + att filnamn-knappen är disabled. Utan upload ska menyn öppnas och alla
 * actions (Öppna, Editera externt, Visa, Ladda ner, Analysera, Ta bort)
 * vara åtkomliga och triggas korrekt.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentRow, type DocumentRecord } from "@/components/documents/_document-row";

const baseDoc = {
  id: "d-1",
  matterId: "m-1",
  folderId: null,
  fileName: "stamning.pdf",
  fileSize: 1024,
  mimeType: "application/pdf",
  storagePath: "documents/content/d-1.pdf",
  summary: null,
  documentType: null,
  analyzedAt: null,
  analysisError: null,
  createdAt: new Date(),
  title: null,
  version: 1,
  uploadedById: "u-1",
  uploadedBy: null,
} as unknown as DocumentRecord;

function renderRow(overrides: Partial<React.ComponentProps<typeof DocumentRow>> = {}) {
  const onReanalyze = vi.fn();
  const onDelete = vi.fn();
  const onDragStart = vi.fn();
  const onDragEnd = vi.fn();
  return {
    onReanalyze, onDelete,
    ...render(
      <table>
        <tbody>
          <DocumentRow
            doc={baseDoc}
            depth={0}
            isDragging={false}
            isAnalyzing={false}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onReanalyze={onReanalyze}
            onDelete={onDelete}
            reanalyzePending={false}
            {...overrides}
          />
        </tbody>
      </table>
    ),
  };
}

const openMenu = () => fireEvent.click(screen.getByLabelText("Dokumentåtgärder"));

describe("DocumentRow — kebab-meny + isUploading-guard", () => {
  it("normalt: kebab-trigger öppnar menyn och Analysera/Ta bort fungerar", () => {
    const { onReanalyze, onDelete } = renderRow({ isUploading: false });
    const trigger = screen.getByLabelText("Dokumentåtgärder");
    expect(trigger).not.toBeDisabled();

    openMenu();
    // Alla sex actions finns i menyn
    expect(screen.getByText("Öppna i webbläsaren")).toBeInTheDocument();
    expect(screen.getByText(/Editera externt/)).toBeInTheDocument();
    expect(screen.getByText("Visa")).toBeInTheDocument();
    expect(screen.getByText("Ladda ner")).toBeInTheDocument();
    expect(screen.getByText("Analysera (AI)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Analysera (AI)"));
    openMenu();
    fireEvent.click(screen.getByText("Ta bort"));
    expect(onReanalyze).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("Visa + Ladda ner renderas som riktiga länkar (a[href])", () => {
    renderRow({ isUploading: false });
    openMenu();
    expect(screen.getByText("Visa").closest("a")).toHaveAttribute("href");
    const dl = screen.getByText("Ladda ner").closest("a");
    expect(dl).toHaveAttribute("href");
    expect(dl).toHaveAttribute("download");
  });

  it("isUploading=true: kebab-trigger är disabled → menyn kan inte öppnas", () => {
    const { onReanalyze, onDelete } = renderRow({ isUploading: true });
    const trigger = screen.getByLabelText("Dokumentåtgärder");
    expect(trigger).toBeDisabled();

    fireEvent.click(trigger);
    // Menyn ska inte ha öppnats
    expect(screen.queryByText("Ta bort")).not.toBeInTheDocument();
    expect(onReanalyze).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("isUploading=true: filnamn-knappen är disabled", () => {
    renderRow({ isUploading: true });
    const nameBtn = screen.getByTitle(/Laddar upp — vänta/);
    expect(nameBtn).toBeDisabled();
  });
});
