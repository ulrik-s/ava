"use client";

/**
 * `ThemeToggle` — flytande icon-knapp i övre hörnan som växlar mellan
 * light och dark mode. Klassen `dark` sätts på `<html>` så
 * [[globals.css]]:s `.dark`-overrides applicerar Tailwind-utilities.
 *
 * Designval (per Material/Apple HIG):
 *   • Position: fixed top-right, alltid synlig oavsett scroll/route.
 *     På telefon (under 768 px, #1301) står den i stället i toppremsan bredvid
 *     "Öppna meny" (`variant="inline"`), och den flytande döljs
 *     (globals.css). Förr låg den flytande ovanpå menyknappen, och
 *     huvudmenyn gick inte att öppna i smala fönster eller på telefon (#1297).
 *   • Icon-only (Sun/Moon) med tooltip — minimal visuell tyngd.
 *   • Subtil background med ring för att signalera tryckbarhet utan
 *     att stjäla fokus från huvudinnehållet.
 */

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  readThemeClass, setThemeClass, subscribeTheme, THEME_STORAGE_KEY, type Theme,
} from "@/lib/client/theme/theme-store";

/**
 * Temat läses via `useSyncExternalStore` (#1131). Förr lästes `.dark` i
 * `useState`-initieringen: förrenderad HTML har alltid ljust läge, men
 * head-skriptet har redan satt `.dark` i en mörk webbläsare → annan ikon och
 * etikett än HTML:en → React #418, hela trädet renderades om och första
 * klicket/inmatningen tappades. Server-snapshoten ("light") används under
 * hydreringen; direkt efter byter React till klientens värde utan skillnad.
 */
const serverTheme = (): Theme => "light";

function applyTheme(next: Theme): void {
  setThemeClass(next);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch { /* lagring blockerad — temat gäller bara den här sidan */ }
}

const VARIANT_CLASS = {
  floating: "fixed top-2 right-2 z-[60] inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/80 text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-white hover:text-gray-900 backdrop-blur-sm transition",
  inline: "inline-flex items-center justify-center h-9 w-9 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900",
} as const;

/** `floating` (standard): i övre hörnet. `inline`: i toppremsan på telefon (#1297, #1301). */
export function ThemeToggle({ variant = "floating" }: { variant?: keyof typeof VARIANT_CLASS }) {
  const theme = useSyncExternalStore(subscribeTheme, readThemeClass, serverTheme);
  const toggle = (): void => applyTheme(theme === "dark" ? "light" : "dark");

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Byt till ljust läge" : "Byt till mörkt läge"}
      title={theme === "dark" ? "Ljust läge" : "Mörkt läge"}
      data-theme-toggle={variant}
      className={VARIANT_CLASS[variant]}
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
