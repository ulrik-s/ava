"use client";

/**
 * `ThemeToggle` — flytande icon-knapp i övre hörnan som växlar mellan
 * light och dark mode. Klassen `dark` sätts på `<html>` så
 * [[globals.css]]:s `.dark`-overrides applicerar Tailwind-utilities.
 *
 * Designval (per Material/Apple HIG):
 *   • Position: fixed top-right, alltid synlig oavsett scroll/route.
 *   • Icon-only (Sun/Moon) med tooltip — minimal visuell tyngd.
 *   • Subtil background med ring för att signalera tryckbarhet utan
 *     att stjäla fokus från huvudinnehållet.
 */

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ava.theme";

type Theme = "light" | "dark";

/**
 * Temat läses ur `<html>`-klassen via `useSyncExternalStore` (#1131). Förr
 * lästes klassen i `useState`-initieringen: förrenderad HTML har alltid ljust
 * läge, men head-skriptet har redan satt `.dark` i en mörk webbläsare → annan
 * ikon/etikett än HTML:en → React #418, hela trädet renderades om och första
 * klicket/inmatningen tappades. Server-snapshoten ("light") används under
 * hydreringen; direkt efter byter React till klientens värde utan skillnad.
 */
const listeners = new Set<() => void>();

/** Egna växlingar notifieras direkt; observern fångar ändringar utifrån (ThemeRestore). */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    listeners.delete(onChange);
    observer.disconnect();
  };
}

const readTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
const serverTheme = (): Theme => "light";

function applyTheme(next: Theme): void {
  document.documentElement.classList.toggle("dark", next === "dark");
  for (const notify of listeners) notify();
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch { /* lagring blockerad — temat gäller bara den här sidan */ }
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  const toggle = (): void => applyTheme(theme === "dark" ? "light" : "dark");

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Byt till ljust läge" : "Byt till mörkt läge"}
      title={theme === "dark" ? "Ljust läge" : "Mörkt läge"}
      className="fixed top-2 right-2 z-[60] inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/80 text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-white hover:text-gray-900 backdrop-blur-sm transition"
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
