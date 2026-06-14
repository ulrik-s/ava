/**
 * Test för `PreloadResult` (#6 — utbruten ur ExternalEditSection). Täcker
 * idle→inget, done+resultat (med/utan failed), och done+fel.
 */
import { describe, it, expect } from "vitest-compat";
import { render, screen } from "@testing-library/react";
import { PreloadResult } from "@/components/settings/external-edit-section";

describe("PreloadResult", () => {
  it("renderar inget innan körning är klar", () => {
    const { container } = render(<PreloadResult preload={{ phase: "idle", done: 0, total: 0 }} />);
    expect(container).toBeEmptyDOMElement();
    const r = render(<PreloadResult preload={{ phase: "running", done: 1, total: 3 }} />);
    expect(r.container).toBeEmptyDOMElement();
  });

  it("done + resultat → summering utan failed-del när failed=0", () => {
    render(<PreloadResult preload={{ phase: "done", done: 3, total: 3, result: { downloaded: 2, skipped: 1, failed: 0 } }} />);
    expect(screen.getByText(/2 nedladdade, 1 fanns redan/)).toBeInTheDocument();
    expect(screen.queryByText(/misslyckades/)).not.toBeInTheDocument();
  });

  it("done + resultat med fail>0 → inkluderar misslyckades-del", () => {
    render(<PreloadResult preload={{ phase: "done", done: 5, total: 5, result: { downloaded: 3, skipped: 1, failed: 1 } }} />);
    expect(screen.getByText(/1 misslyckades/)).toBeInTheDocument();
  });

  it("done + fel → felmeddelande", () => {
    render(<PreloadResult preload={{ phase: "done", done: 0, total: 0, error: "nätverk nere" }} />);
    expect(screen.getByText(/✗ nätverk nere/)).toBeInTheDocument();
  });
});
