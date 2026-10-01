"use client";

/**
 * `PwaRegister` — registrerar app-skalets service worker (#1240) och frågar
 * användaren när en ny version väntar.
 *
 * Service workern (`<bas>/sw.js`, byggd av `build-service-worker.ts`) förcachar
 * skalet så att appen går att öppna — omladdning, ny flik — när servern eller
 * nätet ligger nere. Datan kommer som förut ur IndexedDB.
 *
 * Efter en deploy (#1355) får alla flikar veta när en annan flik bytt version,
 * och ett chunk som inte längre finns på servern laddar om fliken en gång.
 *
 * Monteras i root-layouten. Renderar ingenting förrän en uppdatering väntar,
 * så server- och klientrendering är identiska (ingen hydration-skillnad).
 */

import { useEffect, useState } from "react";
import { recoverFromChunkError, watchChunkErrors } from "@/lib/client/pwa/chunk-reload";
import { activateUpdate, watchForTakeover, watchForUpdate, type SwWorkerLike } from "@/lib/client/pwa/sw-update";
import { registerServiceWorker } from "@/lib/client/register-service-worker";

interface PwaRegisterProps {
  /** Registrera överhuvudtaget. Default: produktionsbygge (`next dev` serverar ingen sw.js). */
  enabled?: boolean;
  /** Appens bas-sökväg (`/ava` på GH Pages). */
  basePath?: string;
  /** Omladdning efter versionsbyte (injicerbar för tester). */
  reload?: () => void;
}

/**
 * Vad användaren behöver veta om versionen:
 *   - `waiting`: en ny version väntar ("Ladda om" låter den ta över),
 *   - `updated`: en annan flik bytte version (#1355) — den här kör det gamla skalet,
 *   - `stale`: delar av appen gick inte att ladda, och en omladdning är redan gjord.
 */
type Notice = { kind: "waiting"; worker: SwWorkerLike } | { kind: "updated" } | { kind: "stale" };

const NOTICE_TEXT: Record<Notice["kind"], string> = {
  waiting: "En ny version av AVA finns.",
  updated: "AVA har uppdaterats i en annan flik.",
  stale: "Delar av AVA kunde inte laddas.",
};

const browserReload = (): void => window.location.reload();

export function PwaRegister({
  enabled = process.env.NODE_ENV === "production",
  basePath = process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "",
  reload = browserReload,
}: PwaRegisterProps) {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void registerServiceWorker(`${basePath}/sw.js`, `${basePath}/`).then((result) => {
      const container = navigator.serviceWorker;
      if (!active || !result.registration) return;
      watchForUpdate(result.registration, () => container.controller !== null, (worker) => {
        if (active) setNotice({ kind: "waiting", worker });
      });
      watchForTakeover(container, () => { if (active) setNotice({ kind: "updated" }); });
    });
    return () => { active = false; };
  }, [enabled, basePath]);

  useEffect(() => {
    if (!enabled) return;
    return watchChunkErrors(window, () => { if (recoverFromChunkError(reload)) setNotice({ kind: "stale" }); });
  }, [enabled, reload]);

  if (!notice) return null;
  const onReload = notice.kind === "waiting" ? () => activateUpdate(notice.worker, navigator.serviceWorker, reload) : reload;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm shadow-lg"
    >
      <span>{NOTICE_TEXT[notice.kind]}</span>
      <button
        type="button"
        className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
        onClick={onReload}
      >
        Ladda om
      </button>
    </div>
  );
}
