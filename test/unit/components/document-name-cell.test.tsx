/**
 * Test: DocumentNameCell (#1795) — namncellen som dokumentvyns båda vyer delar.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { DocumentNameCell, type NameCellDoc } from "@/components/documents/_document-name-cell";

const OLD = new Date(Date.now() - 60 * 60 * 1000);

const baseDoc: NameCellDoc = {
  id: "d-1" as NameCellDoc["id"],
  fileName: "stamning.pdf",
  storagePath: "documents/content/d-1.pdf",
  createdAt: OLD,
  analyzedAt: OLD,
  analysisError: null,
  title: null,
  summary: null,
};

function renderCell(props: Partial<React.ComponentProps<typeof DocumentNameCell>> = {}) {
  const onOpen = vi.fn();
  render(<DocumentNameCell doc={baseDoc} isAnalyzing={false} onOpen={onOpen} {...props} />);
  return { onOpen };
}

const nameButton = () => screen.getByRole("button", { name: /📄/ });

describe("DocumentNameCell", () => {
  it("visar titeln med filnamnet under", () => {
    renderCell({ doc: { ...baseDoc, title: "Stämningsansökan" } });
    expect(screen.getByText("Stämningsansökan")).toBeInTheDocument();
    expect(screen.getByText("stamning.pdf")).toBeInTheDocument();
  });

  it("utan titel visas bara filnamnet", () => {
    renderCell();
    expect(screen.getAllByText("stamning.pdf")).toHaveLength(1);
  });

  it("visar riktning, mottagare och typ", () => {
    renderCell({ doc: { ...baseDoc, direction: "INKOMMANDE", recipient: "DOMSTOL", kinds: ["STAMNING"] } });
    expect(screen.getByText("↓ Ink.")).toBeInTheDocument();
    expect(screen.getByText(/från/)).toBeInTheDocument();
  });

  it("utgående dokument till mottagaren", () => {
    renderCell({ doc: { ...baseDoc, direction: "UTGAENDE", recipient: "MOTPART" } });
    expect(screen.getByText("↑ Utg.")).toBeInTheDocument();
    expect(screen.getByText(/till/)).toBeInTheDocument();
  });

  it("visar \"⏳ analyseras…\" när isAnalyzing", () => {
    renderCell({ isAnalyzing: true });
    expect(screen.getByText("⏳ analyseras…")).toBeInTheDocument();
  });

  it("visar \"⏳ analyseras…\" för ett nytt dokument som inte analyserats än", () => {
    renderCell({ doc: { ...baseDoc, createdAt: new Date(), analyzedAt: null } });
    expect(screen.getByText("⏳ analyseras…")).toBeInTheDocument();
  });

  it("visar inget analysmärke för ett gammalt oanalyserat dokument", () => {
    renderCell({ doc: { ...baseDoc, analyzedAt: null } });
    expect(screen.queryByText("⏳ analyseras…")).not.toBeInTheDocument();
  });

  it("visar \"⚠ analys-fel\" med felet som verktygstips", () => {
    renderCell({ doc: { ...baseDoc, analysisError: "timeout" } });
    expect(screen.getByText("⚠ analys-fel")).toHaveAttribute("title", "timeout");
  });

  it("döljer analys-felet medan en ny analys pågår", () => {
    renderCell({ isAnalyzing: true, doc: { ...baseDoc, analysisError: "timeout" } });
    expect(screen.queryByText("⚠ analys-fel")).not.toBeInTheDocument();
  });

  it("isUploading: märket \"● Laddar upp\" med verktygstips och spärrad namnknapp", () => {
    const { onOpen } = renderCell({ isUploading: true });
    const badge = screen.getByText("Laddar upp").closest("span");
    expect(badge).toHaveAttribute("title", "Laddar upp — vänta tills filen är registrerad");
    expect(badge).toHaveClass("bg-amber-100", "text-amber-800");
    expect(screen.queryByText(/Lokal/)).not.toBeInTheDocument();
    expect(nameButton()).toBeDisabled();
    fireEvent.click(nameButton());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("utan uppladdning: inget märke, och klick anropar onOpen", () => {
    const { onOpen } = renderCell();
    expect(screen.queryByText("Laddar upp")).not.toBeInTheDocument();
    expect(nameButton()).not.toBeDisabled();
    fireEvent.click(nameButton());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("namnknappens verktygstips är sammanfattningen när den finns", () => {
    renderCell({ doc: { ...baseDoc, summary: "Kort sammanfattning" } });
    expect(nameButton()).toHaveAttribute("title", "Kort sammanfattning");
  });
});
