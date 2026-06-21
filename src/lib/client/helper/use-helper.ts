"use client";

/**
 * `useHelper` — React-hook som detekterar om AVA Helper kör på localhost
 * och returnerar dess version. Webbappen bedömer utifrån detta om den
 * kan delegera "öppna dokument externt" till helpern (1-klicks-flow)
 * eller falla tillbaka till den befintliga download/modal-vägen.
 *
 * Transport (ADR 0006): helpern serverar både HTTP (127.0.0.1) och HTTPS
 * (localhost, betrott lokalt cert). Safari/WKWebView (Office-add-ins på Mac)
 * blockerar https-sida → http-loopback som mixed content, så vi PROVAR HTTPS
 * först och faller tillbaka på HTTP (Chromium/Firefox där loopback redan är
 * secure context). Den fungerande basen cachas.
 *
 * Request-/response-former + URL:er delas med själva helper-binären via
 * `@/lib/shared/helper/protocol` (#78).
 */

import { useEffect, useState } from "react";

import {
  HELPER_BASE,
  HELPER_HTTPS_BASE,
  parsePingVersion,
  type ComposeMailRequest,
  type HelperOpenRequest,
  type HelperStatus,
  type HelperStatusResponse,
} from "@/lib/shared/helper/protocol";

export type { HelperStatus, HelperStatusResponse };

// HTTPS först (Safari kräver det), sedan HTTP (Chromium/Firefox).
const PROBE_ORDER = [HELPER_HTTPS_BASE, HELPER_BASE] as const;
let cachedBase: string | undefined;

/**
 * Skydd mot probe-storm (#653): en MISS cachas inte (helpern kan startas
 * senare), men utan broms kan en anropare i en render-loop fyra av tusentals
 * `/ping` per sekund → socket-svält (ERR_INSUFFICIENT_RESOURCES) som svälter
 * resten av appen (t.ex. fastnade "Laddar inställningar…"). Vi
 *   1. dedupar samtidiga probar (in-flight) → en faktisk probe åt gången, och
 *   2. negativ-cachar en miss i `MISS_TTL_MS` → max ~1 probe/intervall.
 */
const MISS_TTL_MS = 10_000;
let inFlight: Promise<{ base: string; version: string | null } | null> | null = null;
let lastMissAt = 0;

async function pingText(base: string, timeoutMs = 500): Promise<string | null> {
  try {
    const r = await fetch(`${base}/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/**
 * Pinga helpern och returnera fungerande transport + version. En cachad bas
 * provas direkt (bekräftar liveness); annars provas PROBE_ORDER. Miss-broms +
 * in-flight-dedup enligt ovan; `now()` injicerbar för test.
 */
async function probeHelper(now: () => number = Date.now): Promise<{ base: string; version: string | null } | null> {
  if (inFlight) return inFlight; // dedup: dela pågående probe
  if (cachedBase === undefined && now() - lastMissAt < MISS_TTL_MS) return null; // negativ-cache
  inFlight = (async () => {
    const bases = cachedBase !== undefined ? [cachedBase] : PROBE_ORDER;
    for (const base of bases) {
      const text = await pingText(base);
      if (text !== null) {
        cachedBase = base;
        return { base, version: parsePingVersion(text) };
      }
    }
    cachedBase = undefined; // cachad bas svarar inte → prova om efter MISS_TTL_MS
    lastMissAt = now();
    return null;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Den transport (https/http) helpern svarar på, eller null. */
export async function resolveHelperBase(): Promise<string | null> {
  return (await probeHelper())?.base ?? null;
}

/** Endast för tester: nollställ transport-cachen + storm-broms-staten. */
export function resetHelperBaseCache(): void {
  cachedBase = undefined;
  inFlight = null;
  lastMissAt = 0;
}

export function useHelper(): HelperStatus {
  const [status, setStatus] = useState<HelperStatus>({ version: undefined, checked: false });

  useEffect(() => {
    let cancelled = false;
    async function ping(): Promise<void> {
      const probe = await probeHelper();
      if (cancelled) return;
      setStatus({ version: probe?.version ?? null, checked: true });
    }
    void ping();
    return () => { cancelled = true; };
  }, []);

  return status;
}

/** Fetch mot helpern på den upplösta transporten; null om helpern saknas. */
async function helperFetch(path: string, init: RequestInit): Promise<Response | null> {
  const base = await resolveHelperBase();
  return base === null ? null : fetch(`${base}${path}`, init);
}

/**
 * `openViaHelper` — skickar `POST /open` till helpern. AVA-webbappen
 * konstruerar absolute download/upload-URLs baserat på vilken backend
 * som körs (git-http eller REST).
 */
export async function openViaHelper(input: HelperOpenRequest): Promise<void> {
  const r = await helperFetch("/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(10_000),
  });
  if (r === null) throw new Error("AVA Helper inte tillgänglig");
  if (!r.ok) {
    throw new Error(`helper /open: HTTP ${r.status} ${await r.text()}`);
  }
}

/**
 * Hämta helperns upload-kö-status (`GET /status`, ADR 0028 §8). Returnerar
 * null om helpern saknas eller svaret inte går att tolka — så anroparen kan
 * dölja synk-status helt när ingen helper finns.
 */
export async function fetchHelperStatus(): Promise<HelperStatusResponse | null> {
  try {
    const r = await helperFetch("/status", { signal: AbortSignal.timeout(2_000) });
    if (r === null || !r.ok) return null;
    const data = (await r.json()) as Partial<HelperStatusResponse>;
    if (typeof data.pending !== "number" || typeof data.conflict !== "number" || typeof data.total !== "number" || !Array.isArray(data.entries)) {
      return null;
    }
    return { pending: data.pending, conflict: data.conflict, total: data.total, entries: data.entries };
  } catch {
    return null;
  }
}

/**
 * Pollar helperns synk-status periodiskt (default var 5:e sekund) så
 * webbappen kan visa "väntar på synk / konflikt". null tills första svaret,
 * och om helpern saknas. Pollningen stannar när komponenten avmonteras.
 */
export function useHelperSyncStatus(intervalMs = 5_000): HelperStatusResponse | null {
  const [sync, setSync] = useState<HelperStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(): Promise<void> {
      const s = await fetchHelperStatus();
      if (cancelled) return;
      setSync(s);
      timer = setTimeout(() => void poll(), intervalMs);
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  return sync;
}

/** Trigga omedelbar self-update-kontroll. */
export async function triggerHelperUpdateCheck(): Promise<void> {
  await helperFetch("/check-update", {
    method: "POST",
    signal: AbortSignal.timeout(2_000),
  }).catch(() => null);
}

/**
 * `composeMailViaHelper` — be helpern öppna OS:s mail-app med en
 * förifylld kompositions-vy + bifogad fil. Helpern sparar bytes till
 * tempfil och anropar plattforms-specifikt mail-kommando (osascript
 * Mail.app på macOS, xdg-email på Linux, COM på Windows).
 *
 * Returnerar true om helpern accepterade requesten, false om något
 * gick fel (helper saknas, 404 = äldre version, network error, etc.)
 * så caller kan logga + falla tillbaka tyst.
 */
export async function composeMailViaHelper(input: ComposeMailRequest): Promise<boolean> {
  try {
    const r = await helperFetch("/compose-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
    return r?.ok ?? false;
  } catch {
    return false;
  }
}
