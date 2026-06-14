"use client";

/**
 * `DiagnosticsRegistrar` — sido-effekt-komponent som installerar
 * console-/felfångsten ([[log-buffer]]) mot den app-wide logg-bufferten så
 * tidigt som möjligt i klient-trädet. Renderar inget.
 *
 * Idempotent: `installConsoleCapture` no-op:ar vid dubbel-mount (React
 * StrictMode kör effekter två gånger i dev).
 */

import { useEffect } from "react";
import { logBuffer } from "@/lib/client/diagnostics";
import { installConsoleCapture } from "@/lib/client/diagnostics/log-buffer";

export function DiagnosticsRegistrar() {
  useEffect(() => {
    const uninstall = installConsoleCapture({ buffer: logBuffer });
    return uninstall;
  }, []);
  return null;
}
