/**
 * Test-batteri för `ActionMenu` (touch-vänlig kebab/overflow-meny).
 *
 * Täcker: stängd som default, öppna/stäng på trigger, items renderas i
 * portal, onSelect-callback + auto-stäng, länk-items (href/download/newTab),
 * disabled-trigger, disabled-item, Escape-stäng, utanför-klick-stäng,
 * aria-attribut.
 *
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";

function setup(items: ActionMenuItem[], props: Partial<React.ComponentProps<typeof ActionMenu>> = {}) {
  return render(<ActionMenu items={items} {...props} />);
}

const trigger = () => screen.getByRole("button", { name: "Åtgärder" });

describe("ActionMenu", () => {
  it("är stängd som default (inga menuitems synliga)", () => {
    setup([{ key: "a", label: "Alpha", onSelect: vi.fn() }]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
  });

  it("öppnar på klick och visar alla items", () => {
    setup([
      { key: "a", label: "Alpha", onSelect: vi.fn() },
      { key: "b", label: "Beta", onSelect: vi.fn() },
    ]);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  it("anropar onSelect och stänger menyn", () => {
    const onSelect = vi.fn();
    setup([{ key: "a", label: "Alpha", onSelect }]);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByText("Alpha"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("toggle: andra klicket på triggern stänger menyn", () => {
    setup([{ key: "a", label: "Alpha", onSelect: vi.fn() }]);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(trigger());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("länk-item renderas som <a> med href/download/target", () => {
    setup([{ key: "dl", label: "Ladda ner", href: "/file.pdf", download: true, newTab: true }]);
    fireEvent.click(trigger());
    const link = screen.getByText("Ladda ner").closest("a")!;
    expect(link).toHaveAttribute("href", "/file.pdf");
    expect(link).toHaveAttribute("download");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("disabled trigger öppnar inte menyn", () => {
    setup([{ key: "a", label: "Alpha", onSelect: vi.fn() }], { disabled: true });
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("disabled item: href tas bort + aria-disabled satt", () => {
    setup([{ key: "v", label: "Visa", href: "/x", disabled: true }]);
    fireEvent.click(trigger());
    const link = screen.getByText("Visa").closest("a")!;
    expect(link).not.toHaveAttribute("href");
    expect(link).toHaveAttribute("aria-disabled", "true");
  });

  it("Escape stänger menyn", () => {
    setup([{ key: "a", label: "Alpha", onSelect: vi.fn() }]);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("utanför-klick stänger menyn", () => {
    setup([{ key: "a", label: "Alpha", onSelect: vi.fn() }]);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("scroll i nästlad container stänger INTE menyn (regression: capture-bug)", () => {
    // En scrollbar container i DOM:en (motsvarar tabellens overflow-x-auto).
    const inner = document.createElement("div");
    document.body.appendChild(inner);
    setup([{ key: "a", label: "Alpha", onSelect: vi.fn() }]);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // scroll bubblar inte → window-lyssnaren (utan capture) ska inte trigga
    fireEvent.scroll(inner);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    document.body.removeChild(inner);
  });

  it("sid-scroll (window) stänger menyn", () => {
    setup([{ key: "a", label: "Alpha", onSelect: vi.fn() }]);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("anpassad aria-label på trigger + meny", () => {
    setup([{ key: "a", label: "Alpha", onSelect: vi.fn() }], { label: "Dokumentåtgärder" });
    const t = screen.getByRole("button", { name: "Dokumentåtgärder" });
    fireEvent.click(t);
    expect(screen.getByRole("menu", { name: "Dokumentåtgärder" })).toBeInTheDocument();
  });
});
