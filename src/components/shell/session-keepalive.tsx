"use client";

/**
 * `SessionKeepalive` — frågar oauth2-proxy med jämna mellanrum medan appen är
 * öppen, så att en förnyad session når webbläsaren (#1425). Renderar ingenting.
 */

import { useEffect } from "react";
import { startBrowserSessionKeepalive } from "@/lib/client/auth/session-keepalive";

interface SessionKeepaliveProps {
  /** Starta keepalive:n; returnerar stoppet. Injicerbar för tester. */
  start?: () => () => void;
}

export function SessionKeepalive({ start = startBrowserSessionKeepalive }: SessionKeepaliveProps) {
  useEffect(() => start(), [start]);
  return null;
}
