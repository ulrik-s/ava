/**
 * `BarChart` (#2110) — generellt stapeldiagram där varje stapel är en knapp.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { BarChart } from "@/components/ui/bar-chart";

const BARS = [
  { key: "a", label: "mån", value: 120, ariaLabel: "Måndag: 2 h" },
  { key: "b", label: "tis", value: 0, ariaLabel: "Tisdag: 0 h" },
  { key: "c", label: "ons", value: 60, ariaLabel: "Onsdag: 1 h" },
];

function renderChart(selectedKey: string | null = null, bars = BARS) {
  const onSelect = vi.fn();
  render(<BarChart bars={bars} selectedKey={selectedKey} onSelect={onSelect} />);
  return onSelect;
}

function barOf(name: string): HTMLElement {
  const fill = screen.getByRole("button", { name }).querySelector<HTMLElement>("[data-bar]");
  if (!fill) throw new Error(`ingen stapel i ${name}`);
  return fill;
}

describe("BarChart", () => {
  it("ger staplarna höjd i förhållande till det största värdet", () => {
    renderChart();
    expect(barOf("Måndag: 2 h").style.height).toBe("100%");
    expect(barOf("Onsdag: 1 h").style.height).toBe("50%");
  });

  it("visar en stapel med 0 som en tunn linje som går att välja", () => {
    const onSelect = renderChart();
    const zero = barOf("Tisdag: 0 h");
    expect(zero.style.height).toBe("0%");
    expect(zero).toHaveClass("min-h-0.5");
    fireEvent.click(screen.getByRole("button", { name: "Tisdag: 0 h" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("ger alla staplar höjden 0 när inget värde är större än 0", () => {
    renderChart(null, [{ key: "x", label: "x", value: 0, ariaLabel: "X" }]);
    expect(barOf("X").style.height).toBe("0%");
  });

  it("har aria-label, aria-pressed på den valda och etiketterna under staplarna", () => {
    renderChart("c");
    expect(screen.getByRole("button", { name: "Onsdag: 1 h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Måndag: 2 h" })).toHaveAttribute("aria-pressed", "false");
    expect(barOf("Onsdag: 1 h")).toHaveClass("bg-blue-700");
    expect(barOf("Måndag: 2 h")).toHaveClass("bg-blue-400");
    for (const label of ["mån", "tis", "ons"]) expect(screen.getByText(label)).toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) expect(b).toHaveAttribute("type", "button");
  });

  it("anropar onSelect vid klick", () => {
    const onSelect = renderChart();
    fireEvent.click(screen.getByRole("button", { name: "Måndag: 2 h" }));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("anropar onSelect med Enter och mellanslag på en fokuserad stapel, men inte med andra tangenter", () => {
    const onSelect = renderChart();
    const bar = screen.getByRole("button", { name: "Onsdag: 1 h" });
    bar.focus();
    fireEvent.keyDown(bar, { key: "Enter" });
    fireEvent.keyDown(bar, { key: " " });
    fireEvent.keyDown(bar, { key: "a" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, "c");
    expect(onSelect).toHaveBeenNthCalledWith(2, "c");
  });

  it("skrollar i sidled inom rutan när staplarna inte ryms", () => {
    const { container } = render(<BarChart bars={BARS} selectedKey={null} onSelect={vi.fn()} />);
    expect(container.firstElementChild).toHaveClass("overflow-x-auto");
  });
});
