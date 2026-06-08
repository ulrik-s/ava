/**
 * Tester för `RenderErrorBoundary`.
 *
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { render, screen } from "@testing-library/react";
import { RenderErrorBoundary } from "@/components/ui/render-error-boundary";

function Crash(): never { throw new Error("Boom"); }
function Ok(): React.ReactElement { return <div>fungerande barn</div>; }

describe("RenderErrorBoundary", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); });

  it("renderar barn när inget kastar", () => {
    render(<RenderErrorBoundary><Ok /></RenderErrorBoundary>);
    expect(screen.getByText("fungerande barn")).toBeInTheDocument();
  });

  it("fångar render-fel och visar 'Render-fel'-rubrik", () => {
    render(<RenderErrorBoundary><Crash /></RenderErrorBoundary>);
    expect(screen.getByText(/Render-fel/i)).toBeInTheDocument();
    // "Boom" syns både i error-message-raden och i stack-tracen
    expect(screen.getAllByText(/Boom/).length).toBeGreaterThanOrEqual(1);
  });

  it("loggar fel till console.error", () => {
    render(<RenderErrorBoundary><Crash /></RenderErrorBoundary>);
    expect(errSpy).toHaveBeenCalled();
  });
});
