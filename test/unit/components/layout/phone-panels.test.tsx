/**
 * Telefonflikarna (#1672): fliknamnen är feta i ljust läge, på både vald och
 * inaktiv flik; mörkt läge behåller normal vikt.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { PhonePanels } from "@/components/layout/phone-panels";

const panels = [
  { id: "a", title: "Första", render: () => <p>a-innehåll</p> },
  { id: "b", title: "Andra", render: () => <p>b-innehåll</p> },
];

describe("PhonePanels flikar (#1672)", () => {
  it("vald och inaktiv flik är feta i ljust läge och normala i mörkt", () => {
    render(<PhonePanels panels={panels} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    for (const tab of tabs) {
      expect(tab.className.split(/\s+/)).toEqual(expect.arrayContaining(["font-semibold", "dark:font-normal"]));
    }
  });

  it("panelytan ger 8 px mellan avdelningarna (#1844)", () => {
    render(<PhonePanels panels={panels} />);
    expect(screen.getByRole("tabpanel").className.split(/\s+/)).toContain("space-y-2");
  });
});

// #1851: sidan kan begära en flik; användaren byter sedan själv.
describe("PhonePanels activePanel (#1851)", () => {
  const selected = (): string | null | undefined =>
    screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;

  it("fliken följer propen vid start och när den ändras", () => {
    const { rerender } = render(<PhonePanels panels={panels} activePanel="b" />);
    expect(selected()).toBe("Andra");
    expect(screen.getByText("b-innehåll")).toBeInTheDocument();
    rerender(<PhonePanels panels={panels} activePanel="a" />);
    expect(selected()).toBe("Första");
  });

  it("användaren byter flik själv; propen tar den inte tillbaka förrän den ändras", () => {
    const { rerender } = render(<PhonePanels panels={panels} activePanel="b" />);
    fireEvent.click(screen.getByRole("tab", { name: "Första" }));
    expect(selected()).toBe("Första");
    rerender(<PhonePanels panels={panels} activePanel="b" />);
    expect(selected()).toBe("Första");
    rerender(<PhonePanels panels={panels} activePanel={null} />);
    expect(selected()).toBe("Första");
    rerender(<PhonePanels panels={panels} activePanel="b" />);
    expect(selected()).toBe("Andra");
  });

  it("null återställer inte till första fliken; användarens val står kvar", () => {
    const { rerender } = render(<PhonePanels panels={panels} activePanel="a" />);
    fireEvent.click(screen.getByRole("tab", { name: "Andra" }));
    expect(selected()).toBe("Andra");
    rerender(<PhonePanels panels={panels} activePanel={null} />);
    expect(selected()).toBe("Andra");
  });

  it("utan prop är första fliken vald", () => {
    render(<PhonePanels panels={panels} />);
    expect(selected()).toBe("Första");
  });
});

// #1966: flikraden är den delade TabBar; × efter en valbar flik tar bort panelen.
describe("PhonePanels × (#1966)", () => {
  it("bara valbara paneler har ×, och det anropar onClose", () => {
    const onClose = vi.fn();
    render(<PhonePanels panels={panels} closable={new Set(["b"])} onClose={onClose} />);
    expect(screen.getByRole("tablist", { name: "Paneler" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ta bort Första" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ta bort Andra" }));
    expect(onClose).toHaveBeenCalledWith("b");
  });

  it("utan onClose finns inget ×", () => {
    render(<PhonePanels panels={panels} closable={new Set(["b"])} />);
    expect(screen.queryByRole("button", { name: "Ta bort Andra" })).not.toBeInTheDocument();
  });
});
