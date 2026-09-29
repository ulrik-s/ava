/**
 * `ThemeToggle` (#1131) — får inte orsaka en hydreringsskillnad.
 *
 * Buggen: komponenten läste `.dark` från `<html>` redan i `useState`-
 * initieringen. Förrenderad HTML (bygget) har alltid ljust läge, men i en
 * webbläsare med mörkt läge har head-skriptet redan satt `.dark` → klienten
 * renderade en annan ikon och etikett än HTML:en → React #418. React kastar då
 * bort hela trädet och renderar om, och klick/inmatning under tiden försvinner
 * ("första klicket gör inget").
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { ThemeRestore } from "@/components/shell/theme-restore";
import { ThemeToggle } from "@/components/shell/theme-toggle";

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

/** Förrendera som bygget gör (ljust), sätt sedan klientens tema och hydrera. */
async function hydrateWith(clientDark: boolean): Promise<ReturnType<typeof vi.fn>> {
  document.documentElement.classList.remove("dark");
  const html = renderToString(<ThemeToggle />);
  container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  document.documentElement.classList.toggle("dark", clientDark);
  const onRecoverableError = vi.fn();
  await act(async () => {
    root = hydrateRoot(container!, <ThemeToggle />, { onRecoverableError });
  });
  return onRecoverableError;
}

describe("ThemeToggle — hydrering", () => {
  it("mörkt läge i webbläsaren → ingen hydreringsskillnad (React #418)", async () => {
    const onRecoverableError = await hydrateWith(true);
    expect(onRecoverableError).not.toHaveBeenCalled();
  });

  it("… och knappen visar ändå rätt läge efter hydreringen", async () => {
    await hydrateWith(true);
    expect(screen.getByRole("button", { name: "Byt till ljust läge" })).toBeInTheDocument();
  });

  it("ljust läge → oförändrat: ingen skillnad, 'Byt till mörkt läge'", async () => {
    const onRecoverableError = await hydrateWith(false);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Byt till mörkt läge" })).toBeInTheDocument();
  });

  it("följer med när ThemeRestore sätter det sparade temat efter mount", async () => {
    await hydrateWith(false);
    localStorage.setItem("ava.theme", "dark");
    const restore = document.createElement("div");
    document.body.appendChild(restore);
    const { createRoot } = await import("react-dom/client");
    const restoreRoot = createRoot(restore);
    await act(async () => { restoreRoot.render(<ThemeRestore />); });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("button", { name: "Byt till ljust läge" })).toBeInTheDocument();
    act(() => restoreRoot.unmount());
    restore.remove();
  });
});

describe("ThemeToggle — växling", () => {
  it("klick växlar klassen, etiketten och sparar valet", async () => {
    await hydrateWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Byt till mörkt läge" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("ava.theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Byt till ljust läge" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Byt till ljust läge" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("ava.theme")).toBe("light");
  });

  it("blockerad lagring → växlar ändå (bara valet sparas inte)", async () => {
    await hydrateWith(false);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError"); });
    fireEvent.click(screen.getByRole("button", { name: "Byt till mörkt läge" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    setItem.mockRestore();
  });
});

// #1297: under 1024 px låg den flytande knappen ovanpå toppremsans "Öppna meny".
// Där står temaknappen i stället i toppremsan (variant="inline").
describe("ThemeToggle — varianter", () => {
  it("standard: flytande (fixed), märkt för att kunna döljas när toppremsan visas", async () => {
    await hydrateWith(false);
    const btn = screen.getByRole("button", { name: "Byt till mörkt läge" });
    expect(btn.dataset.themeToggle).toBe("floating");
    expect(btn.className).toContain("fixed");
  });

  it("inline: en vanlig knapp i flödet, som växlar tema på samma sätt", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const r = createRoot(container);
    root = r;
    act(() => { r.render(<ThemeToggle variant="inline" />); });
    const btn = screen.getByRole("button", { name: "Byt till mörkt läge" });
    expect(btn.dataset.themeToggle).toBe("inline");
    expect(btn.className).not.toContain("fixed");
    fireEvent.click(btn);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
