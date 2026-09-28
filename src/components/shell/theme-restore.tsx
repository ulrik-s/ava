"use client";

/**
 * `ThemeRestore` — applicerar dark-klassen efter React-hydration.
 *
 * Bakgrund: inline-skriptet i [[layout.tsx]]:s `<head>` sätter `.dark`
 * INNAN hydration → undviker FOUC. Men React 19 / Next 16:s hydration
 * STRIPER bort klassen från `<html>` när den matchar mot statisk HTML
 * (även med `suppressHydrationWarning`). Vi måste därför applicera
 * temat IGEN efter mount — via `setThemeClass`, så temaknappen följer med.
 *
 * Komponenten renderar inget — körs bara för bieffekten.
 */

import { useEffect } from "react";
import { readStoredTheme, setThemeClass } from "@/lib/client/theme/theme-store";

export function ThemeRestore() {
  // useEffect körs EFTER React commit:ar → React har inte chans att
  // strippa klassen igen. Ingen setState här (React Compiler-regeln).
  useEffect(() => {
    setThemeClass(readStoredTheme());
  }, []);
  return null;
}
