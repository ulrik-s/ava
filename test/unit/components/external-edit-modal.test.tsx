/**
 * Tester för ExternalEditModal (#27 coverage) — "Editera externt"-modalens
 * tre tillstånd (closed/error/ok), Office-URI-grenen (docx → Word) och
 * kopiera-path-/stäng-actions.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { ExternalEditModal, type ModalState } from "@/components/documents/external-edit-modal";

function okState(fileName: string): Extract<ModalState, { kind: "ok" }> {
  return {
    kind: "ok",
    fileName,
    folderName: "min-mapp",
    relativePath: `documents/${fileName}`,
    fileHandle: { getFile: async () => new Blob(["x"], { type: "application/octet-stream" }) } as unknown as FileSystemFileHandle,
  };
}

beforeEach(() => {
  vi.stubGlobal("URL", { ...globalThis.URL, createObjectURL: () => "blob:mock", revokeObjectURL: () => {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("ExternalEditModal", () => {
  it("kind=closed → renderar ingenting", () => {
    const { container } = render(<ExternalEditModal state={{ kind: "closed" }} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("kind=error → visar titel + meddelande, Stäng kallar onClose", () => {
    const onClose = vi.fn();
    render(<ExternalEditModal state={{ kind: "error", title: "FSA saknas", message: "Välj en mapp först." }} onClose={onClose} />);
    expect(screen.getByText("FSA saknas")).toBeInTheDocument();
    expect(screen.getByText("Välj en mapp först.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stäng" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("kind=ok (PDF) → visar fil + path, ingen Office-knapp", async () => {
    render(<ExternalEditModal state={okState("avtal.pdf")} onClose={() => {}} />);
    expect(screen.getByText("avtal.pdf")).toBeInTheDocument();
    expect(screen.getAllByText(/min-mapp\/documents\/avtal\.pdf/).length).toBeGreaterThan(0);
    // Vänta in download-url-effekten; PDF → ingen "Öppna direkt i …"-knapp.
    await waitFor(() => expect(screen.getByText(/Öppna fil/)).toBeInTheDocument());
    expect(screen.queryByText(/Öppna direkt i/)).not.toBeInTheDocument();
  });

  it("kind=ok (docx) → Office-knappen 'Öppna direkt i Word' visas när url:en laddats", async () => {
    render(<ExternalEditModal state={okState("skrivelse.docx")} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Öppna direkt i Word/)).toBeInTheDocument());
  });

  it("kind=ok (xlsx) → Excel-appnamn", async () => {
    render(<ExternalEditModal state={okState("kalkyl.xlsx")} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Öppna direkt i Excel/)).toBeInTheDocument());
  });

  it("Kopiera path → skriver mapp/path till clipboard och visar 'Kopierat!'", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ExternalEditModal state={okState("nota.pdf")} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Kopiera path/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("min-mapp/documents/nota.pdf"));
    await waitFor(() => expect(screen.getByText(/Kopierat!/)).toBeInTheDocument());
  });

  it("klick på backdrop stänger, klick i innehållet gör det inte", () => {
    const onClose = vi.fn();
    render(<ExternalEditModal state={{ kind: "error", title: "T", message: "M" }} onClose={onClose} />);
    fireEvent.click(screen.getByText("M")); // inne i modalen → stopPropagation
    expect(onClose).not.toHaveBeenCalled();
  });
});
