"use client";

/**
 * `useHelper` — React-hook som detekterar om AVA Helper kör på localhost
 * och returnerar dess version. Webbappen bedömer utifrån detta om den
 * kan delegera "öppna dokument externt" till helpern (1-klicks-flow)
 * eller falla tillbaka till den befintliga download/modal-vägen.
 *
 * Helpern lyssnar på 127.0.0.1:48761 (se [[helper-app/README.md]]).
 */

import { useEffect, useState } from "react";

const HELPER_BASE = "http://127.0.0.1:48761";

export interface HelperStatus {
  /** undefined = inte kontrollerat än, null = inte tillgänglig, string = installerad version. */
  version: string | undefined | null;
  /** Klart att fetcha mot? (efter första ping). */
  checked: boolean;
}

export function useHelper(): HelperStatus {
  const [status, setStatus] = useState<HelperStatus>({ version: undefined, checked: false });

  useEffect(() => {
    let cancelled = false;
    async function ping(): Promise<void> {
      try {
        const r = await fetch(`${HELPER_BASE}/ping`, {
          signal: AbortSignal.timeout(500),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = (await r.text()).trim();
        // Format: "ava-helper v1.2.3"
        const m = text.match(/^ava-helper\s+(\S+)/);
        if (cancelled) return;
        setStatus({ version: m?.[1] ?? null, checked: true });
      } catch {
        if (cancelled) return;
        setStatus({ version: null, checked: true });
      }
    }
    void ping();
    return () => { cancelled = true; };
  }, []);

  return status;
}

/**
 * `openViaHelper` — skickar `POST /open` till helpern. AVA-webbappen
 * konstruerar absolute download/upload-URLs baserat på vilken backend
 * som körs (git-http eller REST).
 */
export interface HelperOpenInput {
  fileName: string;
  downloadUrl: string;
  uploadUrl?: string;
  authHeader?: string;
}

export async function openViaHelper(input: HelperOpenInput): Promise<void> {
  const r = await fetch(`${HELPER_BASE}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    throw new Error(`helper /open: HTTP ${r.status} ${await r.text()}`);
  }
}

/** Trigga omedelbar self-update-kontroll. */
export async function triggerHelperUpdateCheck(): Promise<void> {
  await fetch(`${HELPER_BASE}/check-update`, {
    method: "POST",
    signal: AbortSignal.timeout(2_000),
  }).catch(() => { /* tyst — best-effort */ });
}
