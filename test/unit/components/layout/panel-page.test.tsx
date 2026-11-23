import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";

vi.mock("@/components/layout/dock-workspace", () => ({
  DockWorkspace: ({ page, panels, activePanel }: {
    page: string; panels: ReadonlyArray<{ id: string; render: () => React.ReactNode }>; activePanel?: string | null;
  }) => (
    <div data-testid="dock" data-page={page} data-active={String(activePanel)}>{panels.map((p) => <div key={p.id}>{p.render()}</div>)}</div>
  ),
}));

const { PanelPage } = await import("@/components/layout/panel-page");

describe("PanelPage", () => {
  it("huvudet överst och panelerna i dockytan för sidtypen", async () => {
    render(<PanelPage page="x" header={<h1>Rubrik</h1>} panels={[{ id: "a", title: "A", render: () => <p>a-innehåll</p> }]} defaultLayout={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Rubrik" })).toBeInTheDocument();
    expect((await screen.findByTestId("dock")).getAttribute("data-page")).toBe("x");
    expect(screen.getByText("a-innehåll")).toBeInTheDocument();
  });

  it("activePanel skickas vidare till arbetsytan (#1851)", async () => {
    render(<PanelPage page="x" header={null} panels={[]} defaultLayout={() => undefined} activePanel="billing" />);
    expect((await screen.findByTestId("dock")).getAttribute("data-active")).toBe("billing");
  });

  it("märker <html> med data-panel-page medan sidan visas, och tar bort märket efteråt (#1845)", () => {
    const { unmount } = render(<PanelPage page="x" header={<h1>Rubrik</h1>} panels={[]} defaultLayout={() => undefined} />);
    expect(document.documentElement.hasAttribute("data-panel-page")).toBe(true);
    unmount();
    expect(document.documentElement.hasAttribute("data-panel-page")).toBe(false);
  });
});
