"use client";

/**
 * `ThemeRestore` — applicerar dark-klassen efter React-hydration.
 *
 * Bakgrund: inline-skriptet i [[layout.tsx]]:s `<head>` sätter `.dark`
 * INNAN hydration → undviker FOUC. Men React 19 / Next 16:s hydration
 * STRIPER bort klassen från `<html>` när den matchar mot statisk HTML
 * (även med `suppressHydrationWarning`). Vi måste därför applicera
 * temat IGEN efter mount.
 *
 * Komponenten renderar inget — körs bara för bieffekten.
 */

import { useEffect } from "react";

const STORAGE_KEY = "ava.theme";

function readStoredTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export function ThemeRestore() {
  // useEffect körs EFTER React commit:ar → React har inte chans att
  // strippa klassen igen. Vi muterar bara DOM (ingen setState) så
  // React Compiler:s "setState in effect"-regel triggas inte.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const t = readStoredTheme();
    document.documentElement.classList.toggle("dark", t === "dark");
  }, []);
  return null;
}
