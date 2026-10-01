/**
 * Maximera/återställ en panelgrupp (#1263).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { MaximizeAction, type MaximizeActionProps } from "@/components/layout/maximize-action";

function setup(initial = false) {
  let maximized = initial;
  let listener: (() => void) | null = null;
  const dispose = vi.fn();
  const api = {
    isMaximized: () => maximized,
    maximize: vi.fn(() => { maximized = true; listener?.(); }),
    exitMaximized: vi.fn(() => { maximized = false; listener?.(); }),
  };
  const containerApi = { onDidMaximizedGroupChange: (l: () => void) => { listener = l; return { dispose }; } };
  const props: MaximizeActionProps = { group: { api }, containerApi };
  const view = render(<MaximizeAction {...props} />);
  return { api, dispose, view };
}

describe("MaximizeAction", () => {
  it("maximerar gruppen och växlar till Återställ", () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Maximera panelen" }));
    expect(api.maximize).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Återställ panelen" })).toHaveAttribute("aria-pressed", "true");
  });

  it("återställer med knappen", () => {
    const { api } = setup(true);
    fireEvent.click(screen.getByRole("button", { name: "Återställ panelen" }));
    expect(api.exitMaximized).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Maximera panelen" })).toBeInTheDocument();
  });

  it("Escape återställer när panelen är maximerad", () => {
    const { api } = setup(true);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(api.exitMaximized).toHaveBeenCalledTimes(1);
  });

  it("Escape gör inget när en dialog är öppen, eller när panelen inte är maximerad", () => {
    const { api } = setup(true);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(api.exitMaximized).not.toHaveBeenCalled();
    dialog.remove();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); });
    expect(api.exitMaximized).not.toHaveBeenCalled();
  });

  it("Escape lyssnar inte när panelen inte är maximerad", () => {
    const { api } = setup(false);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(api.exitMaximized).not.toHaveBeenCalled();
  });

  it("slutar lyssna vid avmontering", () => {
    const { dispose, view } = setup();
    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  // #1293: den maximerade panelen visar en tydlig knapp med text — ikonen
  // ensam (14 px, grå) syntes inte, och resten av panelerna var dolda.
  it("maximerad: knappen visar texten Återställ; annars bara ikonen", () => {
    const { api } = setup(false);
    expect(screen.getByRole("button", { name: "Maximera panelen" })).not.toHaveTextContent("Återställ");
    fireEvent.click(screen.getByRole("button", { name: "Maximera panelen" }));
    expect(api.maximize).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Återställ panelen" })).toHaveTextContent("Återställ");
  });

  // #1293: ett Escape stängde BÅDE dialogen (som lyssnar på document) och
  // maximeringen — vakten på window körde efter att dialogen redan stängts.
  it("Escape som stänger en dialog återställer inte också panelen", () => {
    const { api } = setup(true);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    // Som Modal: stängs av Escape via en lyssnare på document.
    const closeDialog = (e: KeyboardEvent): void => { if (e.key === "Escape") dialog.remove(); };
    document.addEventListener("keydown", closeDialog);
    try {
      act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      expect(dialog.isConnected).toBe(false);
      expect(api.exitMaximized).not.toHaveBeenCalled();
      // Nästa Escape — nu utan dialog — återställer.
      act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      expect(api.exitMaximized).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", closeDialog);
    }
  });

  // #1356: Escape i ett fält eller en meny tillhör dem — panelen står kvar.
  it("Escape i ett inmatningsfält, en textyta, redigerbar text eller en meny återställer inte", () => {
    const { api } = setup(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    item.setAttribute("role", "menuitem");
    menu.appendChild(item);
    const roots: HTMLElement[] = [document.createElement("input"), document.createElement("textarea"), editable, menu];
    roots.forEach((r) => document.body.appendChild(r));
    const press = (t: Element): void => {
      act(() => { t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    };
    try {
      [...roots.slice(0, 3), item].forEach(press);
      expect(api.exitMaximized).not.toHaveBeenCalled();
      // Samma Escape från en vanlig knapp återställer.
      const plain = document.createElement("button");
      roots.push(plain);
      document.body.appendChild(plain);
      press(plain);
      expect(api.exitMaximized).toHaveBeenCalledTimes(1);
    } finally {
      roots.forEach((r) => r.remove());
    }
  });
});
