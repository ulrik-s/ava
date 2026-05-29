"use client";

/**
 * `ThemeToggle` — växlar mellan light och dark mode. Klassen `dark`
 * sätts på `<html>` så CSS i [[globals.css]] kan override:a Tailwind-
 * utilities (bg-white, text-gray-900 etc.).
 *
 * Persisteras i `localStorage.ava.theme = "light" | "dark"`. Vid första
 * besöket använder vi prefers-color-scheme; därefter explicit val.
 */

import { useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "ava.theme";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof window === "undefined") return "light";
  // Inline-skriptet i layout.tsx sätter .dark INNAN React mountar →
  // läs DOM-state istället för localStorage så vi inte trippar React-
  // Compiler:s "setState i useEffect"-varning.
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeToggle() {
  // Lazy initial state — kör bara på client (SSR-stabil eftersom server
  // alltid får "light" och inline-scriptet hinner toggla DOM innan React
  // hydrerar).
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
      className="text-gray-500 hover:text-gray-900 inline-flex items-center gap-1.5 text-sm"
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      <span>{theme === "dark" ? "Ljus" : "Mörk"}</span>
    </button>
  );
}
