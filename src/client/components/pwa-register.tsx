"use client";

/**
 * `PwaRegister` — Client Component som registrerar service worker:n
 * vid mount. Returnerar `null` (ingen synlig UI).
 *
 * Monteras typiskt i root-layouten så registreringen sker en gång
 * per session, oavsett vilken page användaren landar på.
 */

import { useEffect } from "react";
import { registerServiceWorker } from "@/client/lib/register-service-worker";

const IS_DEMO_BUILD = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";

export function PwaRegister() {
  useEffect(() => {
    // Demo-build:n hostas på en sub-path (/ava/) på GitHub Pages.
    // Service-worker:n är designad för rot-scope och skulle cacha
    // root-URL:er som inte finns, plus orsaka stale-bundle-problem
    // när vi pushar nya deploys. Skipa helt i demo.
    if (IS_DEMO_BUILD) {
      // Unregister ev. tidigare SW så stale-cache rensas. Best-effort.
      void unregisterAll();
      return;
    }
    void registerServiceWorker("/sw.js");
  }, []);
  return null;
}

async function unregisterAll(): Promise<void> {
  if (typeof navigator === "undefined") return;
  const sw = navigator.serviceWorker;
  if (!sw) return;
  try {
    const regs = await sw.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // Best-effort
  }
}
