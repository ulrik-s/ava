/**
 * `theme-store` (#1131) — EN plats som sätter `.dark` på `<html>` och säger till
 * dem som visar temat. `ThemeRestore` (efter mount) och `ThemeToggle` (klick)
 * går båda hit, så knappen följer med utan att lyssna på DOM:en.
 */
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { readStoredTheme, readThemeClass, setThemeClass, subscribeTheme } from "@/lib/client/theme/theme-store";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

describe("setThemeClass / readThemeClass", () => {
  it("sätter och tar bort klassen", () => {
    setThemeClass("dark");
    expect(readThemeClass()).toBe("dark");
    setThemeClass("light");
    expect(readThemeClass()).toBe("light");
  });

  it("notifierar prenumeranter synkront; avregistrering stoppar", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    setThemeClass("dark");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setThemeClass("light");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("readStoredTheme", () => {
  it("sparat val vinner", () => {
    localStorage.setItem("ava.theme", "dark");
    expect(readStoredTheme()).toBe("dark");
    localStorage.setItem("ava.theme", "light");
    expect(readStoredTheme()).toBe("light");
  });

  it("inget sparat val → följer OS-inställningen", () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    expect(readStoredTheme()).toBe("dark");
    matchMedia.mockReturnValue({ matches: false } as MediaQueryList);
    expect(readStoredTheme()).toBe("light");
    matchMedia.mockRestore();
  });

  it("ogiltigt sparat värde ignoreras", () => {
    localStorage.setItem("ava.theme", "lila");
    const matchMedia = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    expect(readStoredTheme()).toBe("light");
    matchMedia.mockRestore();
  });

  it("blockerad lagring → ljust", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    expect(readStoredTheme()).toBe("light");
    getItem.mockRestore();
  });
});
