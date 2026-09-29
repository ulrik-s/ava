"use client";

/**
 * `HelperAutoConfig` (ADR 0029) — när den lokala helpern finns OCH servern har
 * en OIDC-config (`system.helperConfig` ≠ null), pushar web-appen configen till
 * helpern över localhost (`POST /config`). Då slipper icke-tekniska användare
 * skapa config-filer för hand — de bara använder AVA i webbläsaren som vanligt
 * och helpern blir konfigurerad.
 *
 * #1161 (piloten mot ava-crm.io):
 *   - Configen hämtas från SERVERN (`loadConfig`). Via in-process-klienten körs
 *     `system.helperConfig` i webbläsaren, där serverns env saknas → alltid null
 *     → helpern konfigurerades aldrig och loggade in mot en gammal server.
 *   - Klar först när helpern TAGIT EMOT configen. Misslyckas hämtningen eller
 *     pushen — t.ex. medan helpern väntar på att användaren ska godkänna
 *     webbplatsen ("Tillåt") — görs ett nytt försök.
 *
 * Renderar inget. Monteras i self-hosted (DemoBootstrap) — demon har ingen server.
 */

import { useEffect, useRef, useState } from "react";
import { configureHelper, useHelper } from "@/lib/client/helper/use-helper";
import type { HelperConfigRequest } from "@/lib/shared/helper/protocol";

/** Nytt försök efter ett misslyckande — samma takt som helper-proben. */
export const CONFIG_RETRY_MS = 15_000;

/**
 * Ett försök: klart, inget att göra (null-config) eller försök igen. Avbrutet
 * (avmonterat) under hämtningen → ingen push.
 */
async function pushOnce(
  loadConfig: () => Promise<HelperConfigRequest | null>, cancelled: () => boolean,
): Promise<"done" | "retry"> {
  const cfg = await loadConfig().catch(() => undefined);
  if (cfg === undefined) return "retry"; // servern gick inte att nå
  if (cfg === null || cancelled()) return "done"; // servern saknar helper-auth / avmonterad
  return (await configureHelper(cfg)) ? "done" : "retry";
}

export function HelperAutoConfig({ loadConfig, retryMs = CONFIG_RETRY_MS }: {
  loadConfig: () => Promise<HelperConfigRequest | null>;
  retryMs?: number;
}): null {
  const present = useHelper().version != null;
  const done = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (done.current || !present) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void pushOnce(loadConfig, () => cancelled).then((outcome) => {
      if (cancelled) return;
      if (outcome === "done") done.current = true;
      else retry = setTimeout(() => setAttempt((a) => a + 1), retryMs);
    });
    return () => { cancelled = true; clearTimeout(retry); };
  }, [present, attempt, loadConfig, retryMs]);

  return null;
}
