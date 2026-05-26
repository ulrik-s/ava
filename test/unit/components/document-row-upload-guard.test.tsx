/**
 * Test: DocumentRow med isUploading=true disable:ar alla actions
 * (klick på namn, Öppna, Visa, Ladda ner, Analysera, Ta bort).
 *
 * Bugg: tidigare visades nyligen-uppladdade dokument direkt med
 * full click-funktionalitet — men FSA-skrivningen + tRPC-register
 * + tree-invalidate är inte alltid klart, så klicken kunde ge fel.
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

describe("DocumentRow — isUploading-guard", () => {
  it("normalt: alla action-knappar är klickbara", () => {
    const { onReanalyze, onDelete } = renderRow({ isUploading: false });
    const analyze = screen.getByTitle(/Kör AI-analys/);
    const remove = screen.getByText(/Ta bort/);
    expect(analyze).not.toBeDisabled();
    expect(remove).not.toBeDisabled();
    fireEvent.click(analyze);
    fireEvent.click(remove);
    expect(onReanalyze).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });

  it("isUploading=true: Analysera + Ta bort + Öppna är disabled", () => {
    const { onReanalyze, onDelete } = renderRow({ isUploading: true });
    const analyze = screen.getByText(/🧠 Analysera/);
    const remove = screen.getByText(/Ta bort/);
    const open = screen.getByText(/🖊 Öppna/);
    expect(analyze).toBeDisabled();
    expect(remove).toBeDisabled();
    expect(open).toBeDisabled();
    fireEvent.click(analyze);
    fireEvent.click(remove);
    fireEvent.click(open);
    expect(onReanalyze).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("isUploading=true: Visa + Ladda ner-länkar är aria-disabled", () => {
    renderRow({ isUploading: true });
    const visa = screen.getByText(/👁 Visa/);
    const ladda = screen.getByText(/⬇ Ladda ner/);
    expect(visa.getAttribute("aria-disabled")).toBe("true");
    expect(ladda.getAttribute("aria-disabled")).toBe("true");
  });

  it("isUploading=true: filnamn-knappen är disabled", () => {
    renderRow({ isUploading: true });
    const nameBtn = screen.getByTitle(/Laddar upp — vänta/);
    expect(nameBtn).toBeDisabled();
  });
});
