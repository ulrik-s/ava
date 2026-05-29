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

import { useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "ava.theme";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  function toggle(): void {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", next === "dark");
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }

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
