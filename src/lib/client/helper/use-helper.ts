"use client";

/**
 * `useHelper` — React-hook som detekterar om AVA Helper kör på localhost
 * och returnerar dess version. Webbappen bedömer utifrån detta om den
 * kan delegera "öppna dokument externt" till helpern (1-klicks-flow)
 * eller falla tillbaka till den befintliga download/modal-vägen.
 *
 * Helpern lyssnar på 127.0.0.1:48761 (se [[helper-app/README.md]]).
 * Request-/response-former + URL delas med själva helper-binären via
 * `@/lib/shared/helper/protocol` (#78) så sidorna aldrig glider isär.
 */

import { useEffect, useState } from "react";

import {
  HELPER_BASE,
  parsePingVersion,
  type ComposeMailRequest,
  type HelperOpenRequest,
  type HelperStatus,
} from "@/lib/shared/helper/protocol";

export type { HelperStatus };

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
        const text = await r.text();
        if (cancelled) return;
        setStatus({ version: parsePingVersion(text), checked: true });
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
export async function openViaHelper(input: HelperOpenRequest): Promise<void> {
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

/**
 * `composeMailViaHelper` — be helpern öppna OS:s mail-app med en
 * förifylld kompositions-vy + bifogad fil. Helpern sparar bytes till
 * tempfil och anropar plattforms-specifikt mail-kommando (osascript
 * Mail.app på macOS, xdg-email på Linux, COM på Windows).
 *
 * Returnerar true om helpern accepterade requesten, false om något
 * gick fel (404 = helper kör äldre version utan endpoint, network
 * error, etc.) så caller kan logga + falla tillbaka tyst.
 */
export async function composeMailViaHelper(input: ComposeMailRequest): Promise<boolean> {
  try {
    const r = await fetch(`${HELPER_BASE}/compose-mail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
