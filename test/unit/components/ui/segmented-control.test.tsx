/**
 * `SegmentedControl` (#1804) — ett val bland några få alternativ.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { SegmentedControl } from "@/components/ui/segmented-control";

const OPTIONS = [
  { value: "a", label: "Alfa" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
] as const;

type Value = (typeof OPTIONS)[number]["value"];

function renderControl(value: Value | null, onChange = vi.fn()) {
  render(<SegmentedControl<Value> options={OPTIONS} value={value} onChange={onChange} ariaLabel="Testval" />);
  return onChange;
}

describe("SegmentedControl", () => {
  it("är en grupp med det givna namnet", () => {
    renderControl("a");
    const group = screen.getByRole("group", { name: "Testval" });
    expect(group).toHaveClass("inline-flex", "overflow-hidden", "rounded-md", "border", "divide-x", "divide-gray-200");
  });

  it("markerar det valda alternativet med aria-pressed och de andra som ej valda", () => {
    renderControl("b");
    expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Alfa" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Gamma" })).toHaveAttribute("aria-pressed", "false");
  });

  it("har inget valt alternativ när värdet saknas bland alternativen", () => {
    renderControl(null);
    for (const b of screen.getAllByRole("button")) expect(b).toHaveAttribute("aria-pressed", "false");
  });

  it("anropar onChange med alternativets värde vid klick", () => {
    const onChange = renderControl("a");
    fireEvent.click(screen.getByRole("button", { name: "Gamma" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("tonar ned det valda i grått utan att det ser avstängt ut", () => {
    renderControl("a");
    const selected = screen.getByRole("button", { name: "Alfa" });
    expect(selected).toHaveClass("bg-gray-200", "text-gray-700", "px-3", "py-1.5");
    expect(selected.className).not.toMatch(/opacity|cursor-not-allowed/);
    expect(selected).not.toBeDisabled();
    expect(selected).toHaveAttribute("type", "button");
  });

  it("ger ej valda alternativ primärknapparnas blå färg", () => {
    renderControl("a");
    const other = screen.getByRole("button", { name: "Beta" });
    expect(other).toHaveClass("bg-blue-600", "text-white", "hover:bg-blue-700");
  });
});
