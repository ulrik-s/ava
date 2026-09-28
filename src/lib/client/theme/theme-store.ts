/**
 * `theme-store` (#1131) — ljust/mörkt läge: EN plats som sätter `.dark` på
 * `<html>` och säger till dem som visar temat.
 *
 * Head-skriptet i `layout.tsx` sätter klassen före hydrering (ingen FOUC);
 * `ThemeRestore` sätter den igen efter mount, och `ThemeToggle` vid klick —
 * båda via `setThemeClass`, så knappen (`useSyncExternalStore`) följer med
 * synkront, utan att lyssna på DOM-mutationer.
 */

/** Temat. */
export type Theme = "light" | "dark";

/** localStorage-nyckeln för användarens val (samma som head-skriptet läser). */
export const THEME_STORAGE_KEY = "ava.theme";

const listeners = new Set<() => void>();

/** Prenumerera på temabyten; returnerar avregistreringen. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Temat som `<html>` bär just nu. */
export function readThemeClass(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Sätt temat på `<html>` och notifiera prenumeranterna. */
export function setThemeClass(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  for (const notify of listeners) notify();
}

/** Användarens val, annars OS-inställningen; blockerad lagring → ljust. */
export function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}
