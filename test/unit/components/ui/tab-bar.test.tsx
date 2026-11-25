/**
 * `TabBar` (#1966) — en flikrad där en flik är vald.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { TabBar } from "@/components/ui/tab-bar";

type Id = "a" | "b";

function renderBar(active: Id | undefined, onSelect = vi.fn()) {
  const tabs = [
    { id: "a" as const, label: "Alfa", after: <button type="button">stäng Alfa</button> },
    { id: "b" as const, label: "Beta" },
  ];
  render(<TabBar<Id> tabs={tabs} active={active} onSelect={onSelect} ariaLabel="Testflikar" />);
  return onSelect;
}

const selection = (): (string | null)[] => screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"));

describe("TabBar", () => {
  it("flikraden har sitt namn och den aktiva fliken är vald", () => {
    renderBar("b");
    expect(screen.getByRole("tablist", { name: "Testflikar" })).toBeInTheDocument();
    expect(selection()).toEqual(["false", "true"]);
    expect(screen.getByRole("tab", { name: "Beta" }).className.split(/\s+/)).toEqual(expect.arrayContaining(["bg-blue-600", "text-white"]));
    expect(screen.getByRole("tab", { name: "Alfa" }).className.split(/\s+/)).toEqual(expect.arrayContaining(["text-gray-700", "hover:bg-gray-100", "font-semibold", "dark:font-normal"]));
  });

  it("ett klick anropar onSelect med flikens id", () => {
    const onSelect = renderBar("a");
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("after står direkt efter sin flik", () => {
    renderBar("a");
    expect(screen.getByRole("tab", { name: "Alfa" }).nextElementSibling).toBe(screen.getByRole("button", { name: "stäng Alfa" }));
    expect(screen.getByRole("tab", { name: "Beta" }).nextElementSibling).toBeNull();
  });

  it("utan aktiv flik är ingen vald", () => {
    renderBar(undefined);
    expect(selection()).toEqual(["false", "false"]);
  });
});
