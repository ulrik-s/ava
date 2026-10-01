"use client";

/**
 * Uppstartsskärmarna (#1391) — det som syns innan storen och tRPC-klienten
 * finns.
 *
 * Felskärmen i appträdet kräver en tRPC-klient. Ett fel FÖRE den (t.ex. att
 * den inloggade inte finns i byrån, att servern inte svarar, eller att
 * sessionen gått ut offline) lämnade därför appen på "AVA Laddar…" för alltid.
 * `PendingBootScreen` visar felet direkt, och säger till om uppstarten dröjer
 * längre än `BOOTSTRAP_TIMEOUT_MS`. Uppstarten fortsätter ändå: blir den klar
 * senare tar appen över som vanligt.
 */

import { useEffect, useState } from "react";

/** Uppstartens läge. */
export type BootStatus = "loading" | "ready" | "error";

/** Hur länge uppstarten får ta innan AVA säger till (den fortsätter i bakgrunden). */
export const BOOTSTRAP_TIMEOUT_MS = 45_000;

const TIMEOUT_MESSAGE =
  "Uppstarten tar ovanligt lång tid. Servern eller nätet svarar inte. Försök igen, eller kontakta administratören om det inte hjälper.";

/** Platshållaren medan appen startar. */
export function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="text-lg font-medium text-gray-900 mb-2">AVA</div>
        <div className="text-sm text-gray-500">Laddar…</div>
      </div>
    </div>
  );
}

interface BootErrorScreenProps {
  title: string;
  message: string;
  onRetry: () => void;
}

function BootErrorScreen({ title, message, onRetry }: BootErrorScreenProps) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <div role="alert" className="text-center max-w-md p-6">
        <div className="text-lg font-medium text-red-900 mb-2">{title}</div>
        <div className="text-sm text-red-600 mb-4">{message}</div>
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Försök igen
        </button>
      </div>
    </div>
  );
}

/** true när `active` varit sant i `ms` millisekunder i sträck. */
function useElapsed(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && elapsed;
}

interface PendingBootScreenProps {
  status: BootStatus;
  errorMsg: string | null;
  /** Injicerbara i tester. */
  timeoutMs?: number;
  reload?: () => void;
}

/** Uppstart som ännu inte gett någon tRPC-klient: laddar, fel eller för långsam. */
export function PendingBootScreen({
  status, errorMsg, timeoutMs = BOOTSTRAP_TIMEOUT_MS, reload = () => window.location.reload(),
}: PendingBootScreenProps) {
  const timedOut = useElapsed(status === "loading", timeoutMs);
  if (status === "error") return <BootErrorScreen title="AVA kunde inte starta" message={errorMsg ?? "Okänt fel."} onRetry={reload} />;
  if (timedOut) return <BootErrorScreen title="AVA startar inte" message={TIMEOUT_MESSAGE} onRetry={reload} />;
  return <LoadingScreen />;
}
