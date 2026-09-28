"use client";

/**
 * `PwaRegister` — registrerar app-skalets service worker (#1240) och frågar
 * användaren när en ny version väntar.
 *
 * Service workern (`<bas>/sw.js`, byggd av `build-service-worker.ts`) förcachar
 * skalet så att appen går att öppna — omladdning, ny flik — när servern eller
 * nätet ligger nere. Datan kommer som förut ur IndexedDB.
 *
 * Monteras i root-layouten. Renderar ingenting förrän en uppdatering väntar,
 * så server- och klientrendering är identiska (ingen hydration-skillnad).
 */

import { useEffect, useState } from "react";
import { activateUpdate, watchForUpdate, type SwWorkerLike } from "@/lib/client/pwa/sw-update";
import { registerServiceWorker } from "@/lib/client/register-service-worker";

interface PwaRegisterProps {
  /** Registrera överhuvudtaget. Default: produktionsbygge (`next dev` serverar ingen sw.js). */
  enabled?: boolean;
  /** Appens bas-sökväg (`/ava` på GH Pages). */
  basePath?: string;
  /** Omladdning efter versionsbyte (injicerbar för tester). */
  reload?: () => void;
}

export function PwaRegister({
  enabled = process.env.NODE_ENV === "production",
  basePath = process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "",
  reload = () => window.location.reload(),
}: PwaRegisterProps) {
  const [waiting, setWaiting] = useState<SwWorkerLike | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void registerServiceWorker(`${basePath}/sw.js`, `${basePath}/`).then((result) => {
      const container = navigator.serviceWorker;
      if (!active || !result.registration) return;
      watchForUpdate(result.registration, () => container.controller !== null, (worker) => {
        if (active) setWaiting(worker);
      });
    });
    return () => { active = false; };
  }, [enabled, basePath]);

  if (!waiting) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm shadow-lg"
    >
      <span>En ny version av AVA finns.</span>
      <button
        type="button"
        className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
        onClick={() => activateUpdate(waiting, navigator.serviceWorker, reload)}
      >
        Ladda om
      </button>
    </div>
  );
}
