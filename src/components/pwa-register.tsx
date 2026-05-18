"use client";

/**
 * `PwaRegister` — Client Component som registrerar service worker:n
 * vid mount. Returnerar `null` (ingen synlig UI).
 *
 * Monteras typiskt i root-layouten så registreringen sker en gång
 * per session, oavsett vilken page användaren landar på.
 */

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/register-service-worker";

export function PwaRegister() {
  useEffect(() => {
    void registerServiceWorker("/sw.js");
  }, []);
  return null;
}
